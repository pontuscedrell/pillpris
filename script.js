let availableMonths = [];
let latestMonth = "";
let selectedMonth = ""; 
let currentSearch = null;
let tree = {};
let isExpanded = false;
let lastMatches = []; 
let lastPVPrice = 0;


async function init() {
    try {
        const res = await fetch('substances.json');
        const data = await res.json();
        
        availableMonths = data.months;
        availableMonths.sort((a, b) => b - a); // Nyast först
        
        tree = data.tree;
        latestMonth = availableMonths[0];
        selectedMonth = latestMonth;

        // Fyll i månadsväljaren bredvid sökfältet
        const monthDropdown = document.getElementById('month-select-main');
        if (monthDropdown) {
            monthDropdown.innerHTML = availableMonths.map(m => 
                `<option value="${m}">${formatMedicineDate(m)}</option>`
            ).join('');
        }

        const headerSub = document.getElementById('header-period');
        if (headerSub) {
            headerSub.innerText = `TLV Periodens Varor • ${formatMedicineDate(latestMonth)}`;
        }
    } catch (e) {
        console.error("Kunde inte ladda data", e);
    }
}

document.getElementById('sub-input').oninput = function () {
    const searchTerm = this.value.toLowerCase();
    const listContainer = document.getElementById('package-list');
    const dropdown = document.getElementById('custom-select');
    const resultsDiv = document.getElementById('results');

    listContainer.innerHTML = "";

    if (searchTerm.length < 2) {
        dropdown.style.display = "none";
        return;
    }

    let foundMatch = false;

    for (let sub in tree) {
        if (sub.toLowerCase().includes(searchTerm)) {
            foundMatch = true;
            for (let form in tree[sub]) {
                for (let strength in tree[sub][form]) {
                    tree[sub][form][strength].forEach(size => {
                        const item = document.createElement('div');
                        item.className = 'dropdown-item';
                        item.innerHTML = `
                            <span class="item-line1">${sub} ${strength}</span>
                            <span class="item-line2">${form} | ${size} st</span>
                        `;

                        item.onclick = function () {
                            document.getElementById('sub-input').value = sub;
                            dropdown.style.display = "none";
                            // Vid nytt val, nollställ till senaste månaden eller behåll vald
                            fetchLatestPV(sub, form, strength, size);
                        };
                        listContainer.appendChild(item);
                    });
                }
            }
        }
    }
    dropdown.style.display = foundMatch ? "block" : "none";
};


async function fetchLatestPV(sub, form, str, size) {
    // Spara sökningen globalt så vi kan uppdatera vid månadsbyte
    currentSearch = { sub, form, str, size };
    
    const resultsDiv = document.getElementById('results');
    
    // Visa laddningsvy (men bara om vi inte redan visar data för att undvika blink)
    if (!resultsDiv.innerHTML.includes('price-card')) {
        resultsDiv.innerHTML = "<p style='text-align:center; padding: 40px;'>Hämtar prisdata...</p>";
    }

    try {
        // 1. Hämta data för den valda månaden
        const res = await fetch(`data/${selectedMonth}.json`);
        const data = await res.json();
        
        // Här skapas matches
        let matches = data.filter(i => 
            i.Substans === sub && 
            i.Beredningsform === form && 
            i.Styrka === str && 
            (i.Storlek_Clean === size || i.Storlek.toString() === size)
        );

        if (matches.length === 0) {
            resultsDiv.innerHTML = `
                <div class="reserves-container">
                    <div class="reserves-header">
                        <span>Ingen data för ${formatMedicineDate(selectedMonth)}</span>
                    </div>
                    <p style="padding: 20px; text-align: center; color: #64748b;">
                        Denna förpackning ingick inte i Periodens Vara för valt datum.
                    </p>
                </div>`;
            return;
        }

        // --- NU KAN VI RÄKNA UT BILLIGARE ALTERNATIV ---
        const absoluteMinPrice = Math.min(...matches.map(i => i["Försäljningspris"]));
        const pvProductCandidate = matches.find(i => i.Status.trim().toUpperCase() === "PV");
        const pvPriceCheck = pvProductCandidate ? pvProductCandidate["Försäljningspris"] : 0;
        const cheaperExists = absoluteMinPrice < pvPriceCheck;

        // --- 2. STABIL PRIORITERAD SORTERING ---
        lastMatches = matches.sort((a, b) => {
            const sA = (a.Status || "").trim().toUpperCase();
            const sB = (b.Status || "").trim().toUpperCase();

            const getPriority = (status) => {
                if (status === "PV") return 1;
                if (status.startsWith("R")) {
                    const num = parseInt(status.replace("R", ""));
                    return isNaN(num) ? 10 : num + 1;
                }
                return 100; // Övriga hamnar sist
            };

            const pA = getPriority(sA);
            const pB = getPriority(sB);

            if (pA !== pB) return pA - pB;
            if (a["Försäljningspris"] !== b["Försäljningspris"]) {
                return a["Försäljningspris"] - b["Försäljningspris"];
            }
            return (a.Produktnamn || "").localeCompare(b.Produktnamn || "");
        });

        // Hitta den slutgiltiga PV-produkten efter sortering
        const pvProduct = lastMatches.find(i => i.Status.trim().toUpperCase() === "PV");
        lastPVPrice = pvProduct ? pvProduct["Försäljningspris"] : 0;
        
        // 3. Hämta statistik för historisk analys
        const stats = await getPriceStatistics(sub, form, str, size);

        // 4. Förbered DOM-strukturen
        resultsDiv.innerHTML = `
            <div id="price-card-area"></div>
            <div id="table-area"></div>
        `;

        // 5. Rendera de olika delarna - nu med cheaperExists definierad
        renderPriceCard(pvProduct, sub, str, form, stats, cheaperExists);
        renderTableOnly(); 
        
        // 6. Rendera grafen
        renderHistoryChart(sub, form, str, size);

    } catch (err) {
        console.error("Fel i fetchLatestPV:", err);
        resultsDiv.innerHTML = `<p style="text-align:center; padding: 20px;">Kunde inte ladda data.</p>`;
    }
}

// Hjälpfunktion för att växla tabellens storlek
function toggleTableExpansion() {
    isExpanded = !isExpanded;

    renderTableOnly();
}

async function getPriceStatistics(sub, form, str, size) {
    let prices = [];
    
    // Vi loopar igenom alla tillgängliga månader
    for (const month of availableMonths) {
        try {
            const res = await fetch(`data/${month}.json`);
            const data = await res.json();
            const match = data.find(i => 
                i.Substans === sub && 
                i.Beredningsform === form && 
                i.Styrka === str && 
                (i.Storlek_Clean === size || i.Storlek.toString() === size) &&
                i.Status.trim() === "PV"
            );
            
            if (match) {
                prices.push({
                    month: month,
                    price: match["Försäljningspris"]
                });
            }
        } catch (e) {
            console.warn(`Kunde inte hämta statistik för ${month}`);
        }
    }

    if (prices.length === 0) return null;

    const onlyPrices = prices.map(p => p.price);
    const avgPrice = onlyPrices.reduce((a, b) => a + b, 0) / onlyPrices.length;
    const minData = prices.reduce((prev, curr) => prev.price < curr.price ? prev : curr);
    const maxData = prices.reduce((prev, curr) => prev.price > curr.price ? prev : curr);

    return {
        avgPrice,
        minPrice: minData.price,
        minMonth: minData.month,
        maxPrice: maxData.price,
        maxMonth: maxData.month,
        count: prices.length
    };
}

function renderPriceCard(pvProduct, sub, str, form, stats, cheaperExists) {
    const area = document.getElementById('price-card-area');
    if (!pvProduct || !area) return;

    const formatPrice = (p) => new Intl.NumberFormat("sv-SE", { 
        style: "currency", 
        currency: "SEK" 
    }).format(p);

    const diffFromAvg = stats ? ((lastPVPrice - stats.avgPrice) / stats.avgPrice) * 100 : 0;
    const diffAbs = Math.abs(diffFromAvg).toFixed(0);

    const priceAnalysisBadge = cheaperExists 
        ? `<div class="tooltip">
            <span class="status-badge" style="background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; font-weight: 700; cursor: help;">
                <span class="material-symbols-outlined" style="font-size: 14px; vertical-align: middle; color: #f97316;">warning</span> 
                Billigare alternativ finns
            </span>
            <span class="tooltiptext">
                <strong>Varför inte billigast?</strong><br>
                Priserna för andra varor kan sänkas efter att Periodens Vara utsetts, vilket gör dem billigare än vinnaren.
            </span>
           </div>`
        : `<span class="lowest-price-badge">Lägst pris</span>`;

    let priceStatusLabel = "";
    if (stats) {
        if (diffFromAvg < -0.5) {
            priceStatusLabel = `<span style="color: #16a34a;">↓ ${diffAbs}% mot normalpris</span>`;
        } else if (diffFromAvg > 0.5) {
            priceStatusLabel = `<span style="color: #dc2626;">↑ ${diffAbs}% mot normalpris</span>`;
        } else {
            priceStatusLabel = `<span style="color: #64748b;">Samma som normalpris</span>`;
        }
    }

    const cardAccentStyle = cheaperExists 
        ? 'border-left: 5px solid #f97316; background: linear-gradient(to right, #fffaf5, #ffffff);' 
        : 'border-left: 5px solid #2563eb;';

    area.innerHTML = `
        <div class="price-card" style="${cardAccentStyle}">
            <div class="card-header-flex">
                <div class="product-info-side">
                    <div class="pv-badge-container">
                        <span class="pv-title">Periodens Vara (PV)</span>
                        ${priceAnalysisBadge}
                    </div>
                    <h2 class="product-name" style="margin: 5px 0;">${pvProduct.Produktnamn}</h2>
                    <p class="sub-info" style="color: #64748b; margin-bottom: 0;">${sub} • ${str}</p>
                </div>
                
                <div class="price-info-side">
                    <p class="price-value" style="font-size: 32px; margin: 0; color: #1e293b; font-weight: 800; line-height: 1;">${formatPrice(lastPVPrice)}</p>
                    <p class="price-status-label" style="margin: 8px 0 0 0; font-size: 14px; font-weight: 600;">${priceStatusLabel}</p>
                </div>
            </div>

            <div class="card-grid" style="margin-top: 24px; border-top: 1px solid #f1f5f9; padding-top: 20px; display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 20px;">
                <div class="info-item"><span class="material-symbols-outlined">pill</span><div><p class="label">Pris per enhet</p><p class="value">${formatPrice(pvProduct["Försäljningspris per minsta enhet"])}</p></div></div>
                <div class="info-item"><span class="material-symbols-outlined">corporate_fare</span><div><p class="label">Tillverkare</p><p class="value">${pvProduct.Företag}</p></div></div>
                <div class="info-item"><span class="material-symbols-outlined">package_2</span><div><p class="label">Förpackning</p><p class="value">${formatUnit(form, pvProduct.Storlek)}</p></div></div>
                <div class="info-item"><span class="material-symbols-outlined">public</span><div><p class="label">Ursprung</p><p class="value">${pvProduct.Ursprung || 'Information saknas'}</p></div></div>
            </div>
        </div>
    `;
}

function renderTableOnly() {
    const area = document.getElementById('table-area');
    if (!area) return;

    // VIKTIGT: Ta bort sorteringslogiken här! 
    // Vi använder lastMatches direkt eftersom den sorterades korrekt i fetchLatestPV.

    area.innerHTML = `
        <div class="reserves-container">
            <div class="reserves-header">
                <span>Prisjämförelse (${formatMedicineDate(selectedMonth)})</span>
            </div>
            <table class="reserves-table">
                <thead>
                    <tr>
                        <th>Status</th>
                        <th>Produktnamn</th>
                        <th>Företag</th>
                        <th>Pris</th>
                        <th>Diff (PV)</th>
                    </tr>
                </thead>
                <tbody id="comparison-tbody">
                </tbody>
            </table>
            ${lastMatches.length > 5 ? `
                <div id="pagination-footer" style="text-align: center; padding: 15px; border-top: 1px solid #e2e8f0;">
                </div>
            ` : ''}
        </div>
    `;

    // Kör rad-renderaren med den globalt sorterade datan
    updateTableRows(lastMatches);
}

function updateTableRows(data) {
    const tbody = document.getElementById('comparison-tbody');
    const footer = document.getElementById('pagination-footer');
    if (!tbody) return;

    // 1. Find the absolute lowest price in the current dataset to identify the "Best Buy"
    const minPriceInData = Math.min(...data.map(item => item["Försäljningspris"]));

    // 2. Decide how many rows to show based on the expansion state
    const rowsToShow = (data.length > 5 && !isExpanded) ? data.slice(0, 5) : data;

    tbody.innerHTML = rowsToShow.map(item => {
        const itemPrice = item["Försäljningspris"];
        const diff = itemPrice - lastPVPrice;
        const status = (item.Status || "").trim().toUpperCase();
        const isPV = status === "PV";
        const isReserve = status.startsWith("R");
        
        // 3. Logic for the cheaper alternative highlight
        // Must be the minimum price AND strictly cheaper than the official PV
        const isCheapestAlternative = !isPV && itemPrice === minPriceInData && itemPrice < lastPVPrice;

        // 4. Assign CSS classes for the row and badges
        let badgeClass = "status-other";
        if (isPV) badgeClass = "status-pv";
        else if (isReserve) badgeClass = "status-r";

        // Assign row highlight class
        const rowHighlightClass = isPV ? 'pv-row' : (isCheapestAlternative ? 'cheapest-row' : '');

        return `
            <tr class="${rowHighlightClass}">
                <td>
                    <span class="status-badge ${badgeClass}">${item.Status || 'Övrig'}</span>
                </td>
                <td>
                    <strong>${item.Produktnamn}</strong>
                    ${isCheapestAlternative ? '<span class="best-value-tag">Billigast</span>' : ''}
                </td>
                <td>${item.Företag}</td>
                <td>
                    <span class="${isCheapestAlternative ? 'lowest-price-pill' : ''}">
                        ${itemPrice.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr
                    </span>
                </td>
                <td style="font-weight: 600; color: ${diff > 0 ? '#dc2626' : (diff < 0 ? '#16a34a' : '#64748b')}">
                    ${isPV ? '-' : (diff > 0 ? `+${diff.toFixed(2)} kr` : `${diff.toFixed(2)} kr`)}
                </td>
            </tr>`;
    }).join('');

    // 5. Update the footer button (Visa alla / Visa färre)
    if (footer) {
        footer.innerHTML = `
            <button onclick="toggleTableExpansion()" style="background: none; border: 1px solid #2563eb; color: #2563eb; padding: 8px 20px; border-radius: 20px; cursor: pointer; font-weight: 600; display: inline-flex; align-items: center; gap: 8px;">
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


function formatUnit(form, size) {
    const f = form.toLowerCase();
    let unit = "enheter";
    if (f.includes("tablett")) unit = "tabletter";
    else if (f.includes("kapsel")) unit = "kapslar";
    else if (f === "gel" || f.includes("kräm") || f.includes("salva")) unit = "gram";
    else if (f.includes("droppar") || f.includes("lösning")) unit = "ml";
    return `${size} ${unit}`;
}

async function renderHistoryChart(sub, form, str, size) {
    const ctx = document.getElementById('priceChart').getContext('2d');
    const container = document.getElementById('chart-container');
    const rangeSelect = document.getElementById('chart-range-select');
    const rangeVal = rangeSelect ? rangeSelect.value : "12"; // Default to 12 if not found
    
    // 1. Destroy previous chart instance if it exists
    if (window.myChart instanceof Chart) {
        window.myChart.destroy();
    }

    // 2. Filter the available months based on the dropdown selection
    let filteredMonths = [...availableMonths];

    if (rangeVal === "all") {
        // Use all available months
    } else if (rangeVal.length === 4) { 
        // Logic for specific years (e.g., "2025")
        // Checks if the date code starts with the last two digits of the year (e.g., "25")
        const shortYear = rangeVal.substring(2); 
        filteredMonths = filteredMonths.filter(m => m.toString().startsWith(shortYear));
    } else { 
        // Logic for month ranges (6, 12, 24)
        const limit = parseInt(rangeVal);
        filteredMonths = filteredMonths.slice(0, limit);
    }

    // Sort chronologically for the X-axis (oldest to newest)
    const chronologicalMonths = filteredMonths.reverse();

    // 3. Early exit if no months are found for this filter
    if (chronologicalMonths.length === 0) {
        container.style.display = "none";
        return;
    }

    let historyPoints = [];
    
    // Get stats once to calculate the price deviation (%) in the tooltip
    const stats = await getPriceStatistics(sub, form, str, size);
    
    // 4. Fetch price data for the filtered months
    // We use a for...of loop to ensure data is fetched and processed in order
    for (const month of chronologicalMonths) {
        try {
            const res = await fetch(`data/${month}.json`);
            const data = await res.json();
            
            // Find the PV (Periodens Vara) for this specific month/package
            const match = data.find(i => 
                i.Substans === sub && 
                i.Beredningsform === form && 
                i.Styrka === str && 
                (i.Storlek_Clean === size || i.Storlek.toString() === size) &&
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

    // 5. If no matches were found across all months, hide container
    if (historyPoints.length === 0) {
        container.style.display = "none";
        return;
    }

    // Show the container now that we have data
    container.style.display = "block";

// 6. Initialize Chart.js
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
            pointHoverRadius: 7,
            tension: 0.35, // Smooth curves
            fill: true
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: {
            // Adds internal space so labels don't bleed out of the container
            padding: {
                left: 10,
                right: 20,
                top: 10,
                bottom: 10
            }
        },
        interaction: {
            intersect: false,
            mode: 'index',
        },
        plugins: {
            legend: { display: false },
            title: {
                display: true,
                text: `Prishistorik: ${sub}`,
                align: 'start',
                font: { size: 16, weight: '700' },
                padding: { bottom: 10 }
            },
            tooltip: {
                backgroundColor: 'rgba(30, 41, 59, 0.95)',
                padding: 12,
                titleFont: { size: 14, weight: 'bold' },
                bodyFont: { size: 13 },
                displayColors: false,
                callbacks: {
                    label: function(context) {
                        const point = historyPoints[context.dataIndex];
                        const diffText = point.diff > 0 ? `+${point.diff}%` : `${point.diff}%`;
                        return [
                            `Pris: ${point.y.toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr`,
                            `Tillverkare: ${point.company}`,
                            `Jämfört m. snitt: ${diffText}`
                        ];
                    }
                }
            }
        },
        scales: {
            y: {
                beginAtZero: false,
                grid: { color: '#f1f5f9' },
                ticks: {
                    callback: (v) => v + ' kr',
                    font: { size: 11 },
                }
            },
            x: {
                grid: { display: false },
                ticks: { 
                    font: { size: 10 }, 
                    maxRotation: 45, 
                    minRotation: 45,
                    autoSkip: true, // Automatically hides labels if they don't fit
                    maxTicksLimit: 8 // Prevents X-axis labels from making the chart too wide
                }
            }
        }
    }
});

// Force a resize check to ensure mobile CSS is respected
setTimeout(() => {
    if (window.myChart) {
        window.myChart.resize();
    }
}, 100);
}

document.addEventListener('click', function (e) {
    const dropdown = document.getElementById('custom-select');
    if (!dropdown.contains(e.target) && e.target.id !== 'sub-input') {
        dropdown.style.display = "none";
    }
});

document.addEventListener('DOMContentLoaded', init);