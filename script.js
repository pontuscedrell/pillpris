let searchIndex = []; // Ändra från tree = {} till searchIndex = []
let availableMonths = [];
let selectedMonth = "";
let currentSearch = null;
let isExpanded = false;
let lastMatches = [];
let lastPVPrice = 0;

async function init() {
    try {
        // Om din fil heter substances.json men innehåller den nya index-listan:
        const res = await fetch('search-index.json'); 
        searchIndex = await res.json();

        // Ladda månader (antingen från separat fil eller från indexet)
        const resMonths = await fetch('months.json');
        availableMonths = await resMonths.json();
        availableMonths.sort((a, b) => b - a);

        // ... resten av din datum-logik och dropdown-bygge ...
        const now = new Date();
        const yy = now.getFullYear().toString().slice(-2);
        const mm = (now.getMonth() + 1).toString().padStart(2, '0');
        const systemMonthCode = parseInt(yy + mm);

        selectedMonth = availableMonths.includes(systemMonthCode) ? systemMonthCode : availableMonths[0];
        
        // Uppdatera UI
        const monthDropdown = document.getElementById('month-select-main');
        if (monthDropdown) {
            monthDropdown.innerHTML = availableMonths.map(m => 
                `<option value="${m}" ${m == selectedMonth ? 'selected' : ''}>${formatMedicineDate(m)}</option>`
            ).join('');
            monthDropdown.value = selectedMonth;
        }
    } catch (e) {
        console.error("Kunde inte ladda startdata", e);
    }
}

document.getElementById('sub-input').oninput = function () {
    const searchTerm = this.value.toLowerCase().trim();
    const listContainer = document.getElementById('package-list');
    const dropdown = document.getElementById('custom-select');

    listContainer.innerHTML = "";

    if (searchTerm.length < 2) {
        dropdown.style.display = "none";
        return;
    }

    // 1. Filtrera sökindexet
    let matches = searchIndex.filter(item => {
        const subMatch = item.sub.toLowerCase().includes(searchTerm);
        const nameMatch = item.names.some(name => name.toLowerCase().includes(searchTerm));
        return subMatch || nameMatch;
    });

    // 2. Avancerad sortering
    matches.sort((a, b) => {
        // Nivå 1: Exakt start-matchning (Prioritera det användaren börjat skriva)
        const aStarts = a.sub.toLowerCase().startsWith(searchTerm);
        const bStarts = b.sub.toLowerCase().startsWith(searchTerm);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;

        // Nivå 2: Substansnamn (Alfabetiskt)
        if (a.sub.toLowerCase() !== b.sub.toLowerCase()) {
            return a.sub.localeCompare(b.sub);
        }

        // Nivå 3: Styrka (Numeriskt - t.ex. 5 mg < 10 mg)
        const strengthA = parseFloat(a.str.replace(',', '.')) || 0;
        const strengthB = parseFloat(b.str.replace(',', '.')) || 0;
        if (strengthA !== strengthB) {
            return strengthA - strengthB;
        }

        // Nivå 4: Förpackningsstorlek (Numeriskt)
        const sizeA = parseFloat(a.size) || 0;
        const sizeB = parseFloat(b.size) || 0;
        return sizeA - sizeB;
    });

    // 3. Rendera resultaten
    if (matches.length > 0) {
        // Vi begränsar till 20 träffar för prestanda
        matches.slice(0, 20).forEach(item => {
            const div = document.createElement('div');
            div.className = 'dropdown-item';
            
            // Highlighta substansen i fetstil
            div.innerHTML = `
                <div class="item-line1"><strong>${item.sub}</strong> ${item.str}</div>
                <div class="item-line2">${item.form} | ${item.size}</div>
            `;

            div.onclick = function () {
                document.getElementById('sub-input').value = item.sub;
                dropdown.style.display = "none";
                
                // Använd ID:n från indexet för en exakt och snabb sökning i data-filen
                fetchLatestPV(item); 
            };
            listContainer.appendChild(div);
        });
        dropdown.style.display = "block";
    } else {
        dropdown.style.display = "none";
    }
};


async function fetchLatestPV(searchItem) {
    // 1. Spara sökningen globalt
    currentSearch = searchItem; 
    
    const resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = "<p style='text-align:center; padding: 40px;'>Hämtar prisdata...</p>";

    try {
        // 2. Hämta data för den valda månaden
        const res = await fetch(`data/${selectedMonth}.json`);
        const data = await res.json();
        
        // 3. Matcha på ID:n
        const sub = searchItem.sub;
        const form = searchItem.form;
        const str = searchItem.str;
        const size = searchItem.size;

        let matches = data.filter(i => 
            String(i["Utbytesgrupps ID"]) === String(searchItem.id) &&
            String(i["Förpackningsstorleksgrupp"]) === String(searchItem.size_id)
        );

        if (matches.length === 0) {
            resultsDiv.innerHTML = `<div class="reserves-container"><p style="padding:20px; text-align:center;">Ingen data hittades för denna period.</p></div>`;
            return;
        }

        // 4. Beräkna lägsta pris
        const absoluteMinPrice = Math.min(...matches.map(i => i["Försäljningspris"]));
        
        // 5. Sortering (PV -> Reserv -> Pris)
        lastMatches = matches.sort((a, b) => {
            const getPriority = (s) => {
                const status = (s || "").trim().toUpperCase();
                if (status === "PV") return 1;
                if (status.startsWith("R")) return parseInt(status.substring(1)) + 1;
                return 100;
            };
            return getPriority(a.Status) - getPriority(b.Status);
        });

        const pvProduct = lastMatches.find(i => i.Status.trim().toUpperCase() === "PV") || lastMatches[0];
        lastPVPrice = pvProduct["Försäljningspris"];
        const cheaperExists = absoluteMinPrice < lastPVPrice;

        // 6. Hämta historisk statistik
        const stats = await getPriceStatistics(searchItem);

        // 7. Förbered ytan (Både info-card och insight-card är nu borta)
        resultsDiv.innerHTML = `
            <div id="price-card-area"></div>
            <div id="table-area"></div>
            <div id="chart-container" style="background:white; border-radius:12px; padding:20px; border:1px solid #e2e8f0; margin-top:20px;">
                <canvas id="priceChart" style="height:300px;"></canvas>
            </div>
        `;

        // 8. Rendera komponenter
        await renderPriceCard(pvProduct, sub, str, form, stats, cheaperExists);
        renderTableOnly(); 
        renderHistoryChart(searchItem);

    } catch (err) {
        console.error("Fel vid hämtning av detaljer:", err);
        resultsDiv.innerHTML = "<p>Ett fel uppstod när data skulle laddas.</p>";
    }
}

// Hjälpfunktion för att växla tabellens storlek
function toggleTableExpansion() {
    isExpanded = !isExpanded;

    renderTableOnly();
}

async function getPriceStatistics(searchItem) {
    let prices = [];
    // Vi kollar de 12 senaste månaderna (eller alla tillgängliga)
    for (const month of availableMonths.slice(0, 12)) {
        try {
            const res = await fetch(`data/${month}.json`);
            const data = await res.json();
            
            const match = data.find(i => 
                String(i["Utbytesgrupps ID"]) === String(searchItem.id) &&
                String(i["Förpackningsstorleksgrupp"]) === String(searchItem.size_id) &&
                i.Status.trim().toUpperCase() === "PV"
            );
            
            if (match) prices.push(match["Försäljningspris"]);
        } catch (e) {}
    }

    if (prices.length === 0) return null;

    return {
        avgPrice: prices.reduce((a, b) => a + b, 0) / prices.length,
        minPrice: Math.min(...prices),
        maxPrice: Math.max(...prices),
        count: prices.length
    };
}

async function renderPriceCard(pvProduct, sub, str, form, stats, cheaperExists) {
    const area = document.getElementById('price-card-area');
    if (!pvProduct || !area) return;

    const formatPrice = (p) => new Intl.NumberFormat("sv-SE", { 
        style: "currency", 
        currency: "SEK" 
    }).format(p);

    // --- 1. DATAHÄMTNING (FÖRRA OCH NÄSTA MÅNAD) ---
    const currentIndex = availableMonths.indexOf(parseInt(selectedMonth));
    const prevMonthCode = availableMonths[currentIndex + 1]; 
    const nextMonthCode = availableMonths[currentIndex - 1]; 

    async function fetchSpecificPrice(monthCode) {
        if (!monthCode) return null;
        try {
            const res = await fetch(`data/${monthCode}.json`);
            const data = await res.json();
            const match = data.find(i => 
                String(i["Utbytesgrupps ID"]) === String(currentSearch.id) &&
                String(i["Förpackningsstorleksgrupp"]) === String(currentSearch.size_id) &&
                i.Status.trim().toUpperCase() === "PV"
            );
            return match ? match["Försäljningspris"] : null;
        } catch (e) { return null; }
    }

    const prevPrice = await fetchSpecificPrice(prevMonthCode);
    const nextPrice = await fetchSpecificPrice(nextMonthCode);
    const rec = getPriceRecommendation(lastPVPrice, stats, nextPrice);

    // --- 2. HJÄLPFUNKTION FÖR STATISTIK-BLOCK (FÄRGLOGIK & STOCK-PILAR) ---
    const createStatBlock = (price, label, currentPrice, monthCode, isFuture) => {
        if (!price) {
            return `
                <div style="flex: 1; min-width: 120px;">
                    <p style="margin: 0; color: #94a3b8; font-size: 11px; font-weight: 700; text-transform: uppercase;">${label}</p>
                    <p style="margin: 4px 0 0 0; color: #cbd5e1; font-size: 14px;">Ej fastställt</p>
                </div>`;
        }

        const diff = price - currentPrice;
        const diffPercent = (Math.abs(currentPrice - price) / price) * 100;
        
        let priceColor = "#1e293b"; 
        let trendColor = "#64748b"; 
        let icon = "horizontal_rule";

        if (price !== currentPrice) {
            if (isFuture) {
                const priceWillIncrease = price > currentPrice;
                priceColor = priceWillIncrease ? "#dc2626" : "#16a34a";
                trendColor = priceColor;
                icon = priceWillIncrease ? "trending_up" : "trending_down";
            } else {
                const priceHasDecreased = currentPrice < price; 
                priceColor = !priceHasDecreased ? "#16a34a" : "#dc2626"; 
                trendColor = priceHasDecreased ? "#16a34a" : "#dc2626"; 
                icon = priceHasDecreased ? "trending_down" : "trending_up";
            }
        }

        return `
            <div style="flex: 1; min-width: 120px;">
                <p style="margin: 0; color: #64748b; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">${label} (${formatMedicineDate(monthCode)})</p>
                <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px;">
                    <span style="font-size: 18px; font-weight: 700; color: ${priceColor};">${formatPrice(price)}</span>
                    ${price !== currentPrice ? `
                    <span style="background: ${trendColor}15; color: ${trendColor}; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; display: flex; align-items: center; gap: 2px;">
                        <span class="material-symbols-outlined" style="font-size: 16px;">${icon}</span>
                        ${diffPercent.toFixed(0)}%
                    </span>` : ''}
                </div>
            </div>`;
    };

    // --- 3. VOLATILITET & STABILITET ---
    let stabilityHtml = "";
    if (stats && stats.minPrice && stats.maxPrice) {
        const spread = ((stats.maxPrice - stats.minPrice) / stats.minPrice) * 100;
        if (spread > 15) {
            stabilityHtml = `
                <div style="background: #fffbeb; border-radius: 12px; padding: 16px; margin-top: 20px; display: flex; align-items: flex-start; gap: 12px; border: 1px solid #fef3c7;">
                    <div style="width: 12px; height: 12px; background: #f59e0b; border-radius: 50%; margin-top: 4px; flex-shrink: 0;"></div>
                    <div>
                        <p style="margin: 0; font-weight: 700; color: #92400e; font-size: 14px;">Varierande pris</p>
                        <p style="margin: 2px 0 0 0; color: #b45309; font-size: 13px;">Det här läkemedlet har haft stora prisvariationer senaste året</p>
                    </div>
                </div>`;
        } else if (spread < 10) {
            stabilityHtml = `
                <div style="background: #f0fdf4; border-radius: 12px; padding: 16px; margin-top: 20px; display: flex; align-items: flex-start; gap: 12px; border: 1px solid #dcfce7;">
                    <div style="width: 12px; height: 12px; background: #22c55e; border-radius: 50%; margin-top: 4px; flex-shrink: 0;"></div>
                    <div>
                        <p style="margin: 0; font-weight: 700; color: #166534; font-size: 14px;">Stabilt pris</p>
                        <p style="margin: 2px 0 0 0; color: #15803d; font-size: 13px;">Priset på denna vara har varit stabilt över en längre tid.</p>
                    </div>
                </div>`;
        }
    }

    // --- 4. URSPRUNG & BADGE FÖR BILLIGARE UTBYTE ---
    const ursprungValue = pvProduct.Ursprung || 'Information saknas';
const cheaperBadgeHtml = cheaperExists 
    ? `<span 
        title="Det finns ett annat utbytbart läkemedel i listan nedan som har ett lägre pris än Periodens Vara." 
        style="background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; padding: 2px 10px; border-radius: 6px; font-size: 13px; font-weight: 700; margin-left: 12px; display: inline-flex; align-items: center; gap: 4px; cursor: help;">
            <span class="material-symbols-outlined" style="font-size: 16px;">warning</span> Billigare utbyte finns
       </span>` 
    : "";

    // --- 5. RENDERING ---
    area.innerHTML = `
        <div style="background: white; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.05); overflow: hidden; font-family: sans-serif; width: 100%; border: 1px solid #f1f5f9; margin-bottom: 20px;">
            
            <div style="background: ${rec.bg}; padding: 16px 24px; display: flex; align-items: center; gap: 16px;">
                <div style="background: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                    <span class="material-symbols-outlined" style="color: ${rec.color}; font-size: 20px;">${rec.icon}</span>
                </div>
                <div>
                    <p style="margin: 0; font-weight: 800; color: ${rec.color}; font-size: 15px;">${rec.label}!</p>
                    <p style="margin: 2px 0 0 0; color: ${rec.color}; opacity: 0.8; font-size: 13px;">${rec.subtext}</p>
                </div>
            </div>

            <div style="padding: 24px;">
                <div style="display: flex; justify-content: space-between; flex-wrap: wrap; gap: 32px;">
                    
                    <div style="flex: 1; min-width: 300px;">
                        <div style="display: flex; align-items: center; flex-wrap: wrap;">
                            <h2 style="margin: 0; font-size: clamp(20px, 5vw, 24px); font-weight: 800; color: #1e293b; line-height: 1.2;">
                                ${pvProduct.Produktnamn}
                            </h2>
                            ${cheaperBadgeHtml}
                        </div>
                        <p style="margin: 6px 0; color: #64748b; font-size: 15px;">${sub} · ${str} · ${form}</p>
                        
                        <div style="margin-top: 32px;">
                            <p style="margin: 0; color: #64748b; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Aktuellt pris</p>
                            <span style="font-size: clamp(32px, 8vw, 42px); font-weight: 800; color: #1e293b; display: block; margin-top: 4px;">${formatPrice(lastPVPrice)}</span>
                            
                            <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #f1f5f9; display: flex; gap: 24px; flex-wrap: wrap;">
                                ${createStatBlock(prevPrice, "Föregående", lastPVPrice, prevMonthCode, false)}
                                ${createStatBlock(nextPrice, "Kommande", lastPVPrice, nextMonthCode, true)}
                            </div>
                        </div>
                    </div>

                    <div style="flex: 0 1 260px; background: #f8fafc; border-radius: 12px; padding: 16px; border: 1px solid #f1f5f9;">
                        <p style="margin: 0 0 12px 0; color: #64748b; font-size: 11px; font-weight: 700; text-transform: uppercase;">Information</p>
                        <div style="display: flex; flex-direction: column; gap: 12px;">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <span class="material-symbols-outlined" style="font-size: 18px; color: #94a3b8;">payments</span>
                                <div style="font-size: 13px;">
                                    <span style="display:block; color: #64748b; font-size: 11px;">Pris per enhet</span>
                                    <span style="font-weight: 700; color: #1e293b;">${formatPrice(pvProduct["Försäljningspris per minsta enhet"])}</span>
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <span class="material-symbols-outlined" style="font-size: 18px; color: #94a3b8;">inventory_2</span>
                                <div style="font-size: 13px;">
                                    <span style="display:block; color: #64748b; font-size: 11px;">Förpackning</span>
                                    <span style="font-weight: 700; color: #1e293b;">${formatUnit(form, pvProduct.Storlek)}</span>
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <span class="material-symbols-outlined" style="font-size: 18px; color: #94a3b8;">info</span>
                                <div style="font-size: 13px;">
                                    <span style="display:block; color: #64748b; font-size: 11px;">Typ</span>
                                    <span style="font-weight: 700; color: #1e293b;">${ursprungValue}</span>
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <span class="material-symbols-outlined" style="font-size: 18px; color: #94a3b8;">factory</span>
                                <div style="font-size: 13px;">
                                    <span style="display:block; color: #64748b; font-size: 11px;">Tillverkare</span>
                                    <span style="font-weight: 700; color: #1e293b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; display: inline-block;">${pvProduct.Företag}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                ${stabilityHtml}
            </div>
        </div>`;
}

function renderTableOnly() {
    const area = document.getElementById('table-area');
    if (!area) return;

    area.innerHTML = `
        <div class="reserves-container" style="background: white; border-radius: 16px; padding: 24px 0; border: 1px solid #e2e8f0; margin-top: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.05);">
            <div style="padding: 0 1rem;">
                <h3 style="margin: 0; font-size: 20px; font-weight: 800; color: #1e293b;">Utbytbara alternativ</h3>
                <p style="margin: 8px 0 24px 0; color: #64748b; font-size: 14px;">
                    Alla dessa innehåller samma verksamma ämne: <strong style="color: #1e293b;">${currentSearch.sub} ${currentSearch.str}</strong>
                </p>
            </div>
            
            <div id="comparison-list" style="display: flex; flex-direction: column; gap: 12px;">
                </div>

            <div id="pagination-footer" style="text-align: center; margin-top: 20px; padding: 0 1rem;"></div>

            <div style="margin: 24px 1rem 0 1rem; background: #f0fdfa; border-radius: 12px; padding: 16px; display: flex; gap: 12px; border: 1px solid #ccfbf1;">
                <span class="material-symbols-outlined" style="color: #14b8a6; font-size: 20px;">check_circle</span>
                <div>
                    <p style="margin: 0; font-weight: 700; color: #134e4a; font-size: 14px;">Tips!</p>
                    <p style="margin: 4px 0 0 0; color: #115e59; font-size: 13px; line-height: 1.5;">
                        Be apoteket om det billigaste alternativet...
                    </p>
                </div>
            </div>
        </div>
    `;

    updateTableRows(lastMatches);
}

function updateTableRows(data) {
    const container = document.getElementById('comparison-list');
    const footer = document.getElementById('pagination-footer');
    if (!container) return;

    const minPriceInData = Math.min(...data.map(item => item["Försäljningspris"]));
    const rowsToShow = (data.length > 5 && !isExpanded) ? data.slice(0, 5) : data;

    container.innerHTML = rowsToShow.map((item, index) => {
        const itemPrice = item["Försäljningspris"];
        const diff = itemPrice - lastPVPrice;
        const status = (item.Status || "").trim().toUpperCase();
        
        const isPV = status === "PV";
        const isR1 = status === "R1";
        const isR2 = status === "R2";
        const isCheapest = itemPrice === minPriceInData;

        // FÄRGLOGIK
        let bgColor = "#f8f9fa";
        let borderColor = "transparent";
        let rankColor = "#cbd5e1";
        let statusBadgeHtml = "";

        if (isCheapest) {
            // Billigaste är alltid grönt
            bgColor = "#f0fdf4";
            borderColor = "#5eead4";
            rankColor = "#14b8a6";
            statusBadgeHtml = `
                <span title="Detta är det billigaste tillgängliga alternativet för denna period." 
                      style="background: white; color: #14b8a6; border: 1px solid #14b8a6; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 700; display: flex; align-items: center; gap: 4px; cursor: help;">
                    <span class="material-symbols-outlined" style="font-size: 12px;">star</span> Billigast
                </span>`;
        } 
        
        if (isPV) {
            // Om PV inte är billigast -> Blå, annars ingår den i det gröna ovan
            if (!isCheapest) {
                bgColor = "#eff6ff";
                borderColor = "#bfdbfe";
                rankColor = "#2563eb";
            }
            statusBadgeHtml += `
                <span title="Periodens Vara: Det läkemedel som apoteken i första hand ska erbjuda." 
                      style="background: white; color: #3b82f6; border: 1px solid #3b82f6; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 700; cursor: help;">
                    Periodens vara
                </span>`;
        } else if (isR1 || isR2) {
            // Reserv 1 och 2 är gula
            bgColor = "#fffbeb";
            borderColor = "#fde68a";
            rankColor = "#f59e0b";
            statusBadgeHtml = `
                <span title="Reservalternativ: Används om Periodens Vara är slut på lagret." 
                      style="background: white; color: #d97706; border: 1px solid #f59e0b; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 700; cursor: help;">
                    ${status}
                </span>`;
        }

        return `
            <div style="background: ${bgColor}; border: 2px solid ${borderColor}; border-radius: 12px; padding: 16px; display: flex; align-items: center; justify-content: space-between; position: relative;">
                <div style="display: flex; align-items: center; gap: 16px;">
                    <div style="width: 32px; height: 32px; background: ${rankColor}; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; flex-shrink: 0;">
                        ${index + 1}
                    </div>
                    
                    <div>
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <strong style="font-size: 16px; color: #1e293b;">${item.Produktnamn}</strong>
                            ${statusBadgeHtml}
                        </div>
                        <p style="margin: 2px 0 0 0; color: #94a3b8; font-size: 13px;">${item.Företag}</p>
                    </div>
                </div>

                <div style="text-align: right;">
                    <div style="font-size: 18px; font-weight: 800; color: #1e293b;">
                        ${itemPrice.toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr
                    </div>
                    <div style="font-size: 12px; font-weight: 600; color: #94a3b8; margin-top: 2px;">
                        ${diff === 0 ? 'PV' : (diff > 0 ? `+${diff.toFixed(2)} kr` : `${diff.toFixed(2)} kr`)}
                    </div>
                </div>
            </div>
        `;
    }).join('');

    if (footer) {
        footer.innerHTML = `
            <button onclick="toggleTableExpansion()" style="background: white; border: 1px solid #e2e8f0; color: #64748b; padding: 8px 24px; border-radius: 24px; cursor: pointer; font-weight: 700; font-size: 13px; display: inline-flex; align-items: center; gap: 8px;">
                ${isExpanded ? 'Visa färre' : `Visa alla (${data.length})`}
                <span class="material-symbols-outlined" style="font-size: 18px;">${isExpanded ? 'expand_less' : 'expand_more'}</span>
            </button>
        `;
    }
}

function renderMonthSelector() {
    return `
        <div class="month-selector-wrapper">
            <label for="month-select" style="font-size: 12px; color: #64748b; font-weight: 400;">Period:</label>
            <select id="month-select" onchange="updateMonth(this.value)">
                ${availableMonths.map(m => `
                    <option value="${m}" ${m == selectedMonth ? 'selected' : ''}>
                        ${formatMedicineDate(m)}
                    </option>
                `).join('')}
            </select>
        </div>`;
}

function updateMonth(newMonth) {
    selectedMonth = newMonth;
    // Om en medicin redan är vald, ladda om datan för den nya månaden
    if (currentSearch) {
        // Vi nollställer expansionen när man byter månad för att inte förvirra användaren
        isExpanded = false; 
        fetchLatestPV(currentSearch.sub, currentSearch.form, currentSearch.str, currentSearch.size);
    }
}

function toggleTableExpansion() {
    isExpanded = !isExpanded;
    
    // Vi skickar med den sparade datan direkt till rad-renderaren
    updateTableRows(lastMatches);
}

function formatMedicineDate(dateCode) {
    const codeStr = dateCode.toString();
    const yearShort = codeStr.substring(0, 2);
    const monthIndex = codeStr.substring(2, 4);
    const months = ["Januari", "Februari", "Mars", "April", "Maj", "Juni", "Juli", "Augusti", "September", "Oktober", "November", "December"];
    const fullYear = "20" + yearShort;
    const monthName = months[parseInt(monthIndex, 10) - 1];
    return monthName ? `${monthName} ${fullYear}` : "Okänt datum";
}

function renderInfoCard(item) {
    const area = document.getElementById('info-card-area');
    if (!area) return;

area.innerHTML = `
        <div class="reserves-container" style="background: white; border-radius: 16px; padding: 24px 0; border: 1px solid #e2e8f0; margin-top: 20px;">
            <div style="padding: 0 1rem;">
                <h3 style="margin: 0; font-size: 20px; font-weight: 800; color: #1e293b;">Utbytbara alternativ</h3>
                <p style="margin: 8px 0 24px 0; color: #64748b; font-size: 14px;">
                    Alla dessa innehåller samma verksamma ämne...
                </p>
            </div>
                <span class="material-symbols-outlined">expand_more</span>
            </summary>
            <div style="padding: 15px; border-top: 1px solid #f1f5f9; background: #f8fafc; font-size: 13px;">
                <p><strong>Utbytesgrupp:</strong> ${item.id}</p>
                <p><strong>Varunummer:</strong> ${item.vnr.join(', ')}</p>
                <p><strong>Synonymer:</strong> ${item.names.join(', ')}</p>
            </div>
        </details>
    `;
}

function renderInsightCard(pvPrice, stats, nextPrice) {
    const area = document.getElementById('insight-card-area');
    if (!area || !stats) return;

    // Här kan du lägga till den analyzeMarketData-logik vi tittade på tidigare
    area.innerHTML = `
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 15px; margin-bottom: 20px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
            <div>
                <p style="font-size: 10px; color: #64748b; margin: 0;">HISTORISKT SNITT</p>
                <p style="font-weight: 700; margin: 0;">${stats.avgPrice.toFixed(2)} kr</p>
            </div>
            <div>
                <p style="font-size: 10px; color: #64748b; margin: 0;">LÄGSTA NOTERADE</p>
                <p style="font-weight: 700; margin: 0;">${stats.minPrice.toFixed(2)} kr</p>
            </div>
        </div>
    `;
}

function formatUnit(form, size) {
    const f = form.toLowerCase();
    let unit = "enheter";
    if (f.includes("tablett")) unit = "tabletter";
    else if (f.includes("kapsel")) unit = "kapslar";
    else if (f === "gel" || f.includes("kräm") || f.includes("salva")) unit = "gram";
    else if (f.includes("droppar") || f.includes("lösning")) unit = "ml";
    return `${size} ${unit}`;
}

async function renderHistoryChart(searchItem) {
    const ctx = document.getElementById('priceChart').getContext('2d');
    const container = document.getElementById('chart-container');
    const rangeSelect = document.getElementById('chart-range-select');
    const rangeVal = rangeSelect ? rangeSelect.value : "12"; 
    
    if (window.myChart instanceof Chart) {
        window.myChart.destroy();
    }

    let filteredMonths = [...availableMonths];
    if (rangeVal !== "all") {
        const limit = parseInt(rangeVal);
        filteredMonths = filteredMonths.slice(0, limit);
    }

    const chronologicalMonths = filteredMonths.reverse();
    let historyPoints = [];
    
    // Hämta statistik för att kunna visa avvikelse i tooltip
    const stats = await getPriceStatistics(searchItem);
    
    for (const month of chronologicalMonths) {
        try {
            const res = await fetch(`data/${month}.json`);
            const data = await res.json();
            
            // Använd ID-matchning istället för sträng-matchning
            const match = data.find(i => 
                String(i["Utbytesgrupps ID"]) === String(searchItem.id) &&
                String(i["Förpackningsstorleksgrupp"]) === String(searchItem.size_id) &&
                i.Status.trim().toUpperCase() === "PV"
            );
            
            if (match) {
                const price = match["Försäljningspris"];
                const diffFromAvg = stats ? ((price - stats.avgPrice) / stats.avgPrice) * 100 : 0;

                historyPoints.push({
                    x: formatMedicineDate(month),
                    y: price,
                    company: match.Företag,
                    diff: diffFromAvg.toFixed(1)
                });
            }
        } catch (e) { 
            console.warn(`Kunde inte hämta historik för ${month}`, e); 
        }
    }

    if (historyPoints.length === 0) {
        container.style.display = "none";
        return;
    }

    container.style.display = "block";

    window.myChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: historyPoints.map(p => p.x),
            datasets: [{
                label: 'Pris (SEK)',
                data: historyPoints.map(p => p.y),
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37, 99, 235, 0.08)',
                borderWidth: 3,
                pointRadius: 5,
                pointBackgroundColor: '#2563eb',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                tension: 0.35,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const point = historyPoints[context.dataIndex];
                            return [
                                `Pris: ${point.y.toLocaleString('sv-SE')} kr`,
                                `Företag: ${point.company}`,
                                `vs Snitt: ${point.diff > 0 ? '+' : ''}${point.diff}%`
                            ];
                        }
                    }
                }
            },
            scales: {
                y: { ticks: { callback: (v) => v + ' kr' } },
                x: { ticks: { maxRotation: 45, minRotation: 45 } }
            }
        }
    });
}

document.addEventListener('click', function (e) {
    const dropdown = document.getElementById('custom-select');
    if (!dropdown.contains(e.target) && e.target.id !== 'sub-input') {
        dropdown.style.display = "none";
    }
});

function getPriceRecommendation(currentPrice, stats, nextPrice) {
    const avgPrice = stats?.avgPrice;
    const minPrice = stats?.minPrice;
    const maxPrice = stats?.maxPrice;

    // Standardinställning (Neutral)
    let rec = {
        label: "Normalt pris",
        color: "#64748b",
        icon: "balance",
        bg: "#f8fafc",
        subtext: "Priset är i linje med det historiska snittet.",
        urgency: 0 // 0-3 för att prioritera olika rekommendationer
    };

    // --- 1. ANALYS AV FRAMTIDA PRIS (HÖGST PRIORITET) ---
    if (nextPrice !== null && nextPrice !== undefined) {
        const diffNext = ((nextPrice - currentPrice) / currentPrice) * 100;

        if (diffNext >= 5) {
            // Priset går upp nästa månad
            rec = {
                label: "Köp nu – Prishöjning väntar",
                color: "#c2410c", // Orange/Mörkröd
                icon: "shopping_cart_checkout",
                bg: "#fff7ed",
                subtext: `Priset beräknas stiga med ${diffNext.toFixed(0)}% nästa månad.`,
                urgency: 3
            };
        } else if (diffNext <= -5) {
            // Priset går ner nästa månad
            rec = {
                label: "Vänta – Sänkning på väg",
                color: "#7c3aed", // Lila
                icon: "hourglass_empty",
                bg: "#f5f3ff",
                subtext: `Priset beräknas sänkas med ${Math.abs(diffNext).toFixed(0)}% nästa månad.`,
                urgency: 3
            };
        }
    }

    // --- 2. HISTORISK ANALYS (ANVÄNDS OM FRAMTIDEN ÄR STABIL ELLER SAKNAS) ---
    if (rec.urgency < 3 && avgPrice) {
        const diffAvg = ((currentPrice - avgPrice) / avgPrice) * 100;
        
        // Är priset extremt lågt just nu? (All-time low territory)
        const isNearMin = minPrice && currentPrice <= minPrice * 1.02; 
        const isNearMax = maxPrice && currentPrice >= maxPrice * 0.95;

        if (isNearMin) {
            rec = {
                label: "Historiskt fyndläge",
                color: "#16a34a", // Grön
                icon: "auto_awesome",
                bg: "#f0fdf4",
                subtext: "Detta är ett av de lägsta priserna som noterats det senaste året.",
                urgency: 2
            };
        } else if (diffAvg < -15) {
            rec = {
                label: "Mycket bra pris",
                color: "#15803d",
                icon: "thumb_up",
                bg: "#f0fdf4",
                subtext: `Ca ${Math.abs(diffAvg).toFixed(0)}% billigare än normalt.`,
                urgency: 2
            };
        } else if (isNearMax || diffAvg > 20) {
            rec = {
                label: "Ovanligt högt pris",
                color: "#dc2626", // Röd
                icon: "error",
                bg: "#fef2f2",
                subtext: "Priset är betydligt högre än genomsnittet.",
                urgency: 2
            };
        } else if (diffAvg > 8) {
            rec = {
                label: "Något dyrt just nu",
                color: "#b45309",
                icon: "trending_up",
                bg: "#fffbeb",
                subtext: `Priset ligger ${diffAvg.toFixed(0)}% över snittet.`,
                urgency: 1
            };
        }
    }

    return rec;
}



document.addEventListener('DOMContentLoaded', init);
