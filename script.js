let searchIndex = []; // Ändra från tree = {} till searchIndex = []
let availableMonths = [];
let selectedMonth = "";
let systemMonthCode = null;
let currentSearch = null;
let isExpanded = false;
let lastMatches = [];
let lastPVPrice = 0;
let selectedRowId = null;
let chartPriceType = "pv"; // "pv" or "cheapest"

// Dark mode initialization
if (localStorage.getItem('darkMode') === 'enabled') {
    document.body.classList.add('dark-mode');
}

// Dark mode toggle
document.addEventListener('DOMContentLoaded', () => {
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    if (darkModeToggle) {
        const icon = darkModeToggle.querySelector('.material-symbols-outlined');
        
        // Set initial icon
        if (document.body.classList.contains('dark-mode')) {
            icon.textContent = 'light_mode';
        }
        
        darkModeToggle.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            
            if (document.body.classList.contains('dark-mode')) {
                localStorage.setItem('darkMode', 'enabled');
                icon.textContent = 'light_mode';
            } else {
                localStorage.setItem('darkMode', 'disabled');
                icon.textContent = 'dark_mode';
            }
        });
    }
});

function cloneTemplate(id) {
    const tpl = document.getElementById(id);
    return tpl ? tpl.content.cloneNode(true) : null;
}

function replaceContent(parent, selectorOrFragment, content) {
    if (!parent) return;
    
    // If content is provided, we're using selector mode: replaceContent(parent, '.selector', 'html')
    if (arguments.length === 3) {
        const target = parent.querySelector(selectorOrFragment);
        if (target) target.innerHTML = content;
    } 
    // Otherwise, we're replacing the parent's children with a fragment: replaceContent(parent, fragment)
    else {
        parent.replaceChildren(selectorOrFragment);
    }
}

function getItemStatus(item) {
    const rawStatus = (item?.Status ?? "").toString().trim();
    if (rawStatus) return rawStatus;
    const rankVal = item?.Rang ?? item?.rang;
    const rank = Number(String(rankVal ?? "").replace(',', '.'));
    if (rank === 1) return "PV";
    if (rank === 2) return "R1";
    if (rank === 3) return "R2";
    return "";
}

async function init() {
    try {
        // Om din fil heter substances.json men innehåller den nya index-listan:
        const cacheBust = `v=${Date.now()}`;
        const res = await fetch(`data/search-index.json?${cacheBust}`);
        searchIndex = await res.json();

        // Ladda månader (antingen från separat fil eller från indexet)
        const resMonths = await fetch(`data/months.json?${cacheBust}`);
        availableMonths = await resMonths.json();
        availableMonths.sort((a, b) => b - a);


        // ... resten av din datum-logik och dropdown-bygge ...
        const now = new Date();
        const yy = now.getFullYear().toString().slice(-2);
        const mm = (now.getMonth() + 1).toString().padStart(2, '0');
        systemMonthCode = parseInt(yy + mm);

        // Prefer the current month if available, otherwise use the closest month
        if (availableMonths.includes(systemMonthCode)) {
            selectedMonth = systemMonthCode;
        } else {
            // Find the closest month (prefer earlier months over future months)
            selectedMonth = availableMonths.reduce((closest, month) => {
                if (month <= systemMonthCode) {
                    return !closest || month > closest ? month : closest;
                }
                return closest || month;
            });
        }
        
        // Uppdatera UI
        const monthDropdown = document.getElementById('month-select-main');
        if (monthDropdown) {
            monthDropdown.replaceChildren();
            availableMonths.forEach(m => {
                const option = document.createElement('option');
                const prelimTag = isPrelimMonth(m) ? ' (Preliminär)' : '';
                option.value = m;
                option.textContent = `${formatMedicineDate(m)}${prelimTag}`;
                if (m == selectedMonth) {
                    option.selected = true;
                }
                monthDropdown.appendChild(option);
            });
        }
        
        // Update header with current month
        const headerPeriod = document.getElementById('header-period');
        if (headerPeriod) {
            const prelimTag = isPrelimMonth(selectedMonth) ? " • Preliminär" : "";
            headerPeriod.textContent = `TLV Periodens Varor • ${formatMedicineDate(selectedMonth)}${prelimTag}`;
        }
    } catch (e) {
        console.error("Kunde inte ladda startdata", e);
    }
}

document.getElementById('sub-input').oninput = function () {
    const searchTerm = this.value.toLowerCase().trim();
    const listContainer = document.getElementById('package-list');
    const dropdown = document.getElementById('custom-select');
    const clearBtn = document.getElementById('clear-search');

    selectedDropdownIndex = -1; // Reset selection when search updates
    originalSearchInput = this.value; // Store original search

    // Show/hide clear button
    clearBtn.style.display = this.value.length > 0 ? 'flex' : 'none';

    listContainer.innerHTML = "";

    if (searchTerm.length < 2) {
        dropdown.style.display = "none";
        return;
    }

    // 1. Filtrera sökindexet
    let matches = searchIndex.filter(item => {
        const fullText = (item.sub + ' ' + item.str).toLowerCase();
        const subMatch = item.sub.toLowerCase().includes(searchTerm);
        const nameMatch = item.names.some(name => name.toLowerCase().includes(searchTerm));
        const fullMatch = fullText.includes(searchTerm);
        
        // Also check if search term without "mg" matches
        const searchTermNoMg = searchTerm.replace(/\s*mg\s*$/i, '').trim();
        const subMatchNoMg = searchTermNoMg && item.sub.toLowerCase().includes(searchTermNoMg);
        const nameMatchNoMg = searchTermNoMg && item.names.some(name => name.toLowerCase().includes(searchTermNoMg));
        const fullMatchNoMg = searchTermNoMg && fullText.includes(searchTermNoMg);
        
        // Check if search contains both substance and strength (e.g., "Etoricoxib 90")
        // Split on numbers to handle multi-part searches, but be flexible with delimiters
        let multiPartMatch = false;
        
        // Extract just the substance part (everything before first number or special chars)
        const subPartMatch = searchTerm.match(/^([a-zåäö\s\+\-]+?)(?:\s*(?:\d|\/|$))/i);
        if (subPartMatch) {
            const subPart = subPartMatch[1].trim().toLowerCase();
            // Check if item.sub contains the substance part
            if (item.sub.toLowerCase().includes(subPart)) {
                // Also check if the strength/numbers part matches
                const numberPart = searchTerm.substring(subPartMatch[1].length).trim().toLowerCase();
                if (!numberPart || item.str.toLowerCase().includes(numberPart)) {
                    multiPartMatch = true;
                }
            }
        }
        
        return subMatch || nameMatch || subMatchNoMg || nameMatchNoMg || multiPartMatch || fullMatch || fullMatchNoMg;
    });

    // Store matches for keyboard navigation
    lastDropdownMatches = matches.slice(0, 20);

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

    // Update stored matches after sorting
    lastDropdownMatches = matches.slice(0, 20);

    // 3. Rendera resultaten
    if (matches.length > 0) {
        // Vi begränsar till 20 träffar för prestanda
        matches.slice(0, 20).forEach(item => {
            const itemTemplate = cloneTemplate('template-dropdown-item');
            if (!itemTemplate) return;
            const div = itemTemplate.querySelector('.dropdown-item');
            const subEl = div.querySelector('[data-field="sub"]');
            const strEl = div.querySelector('[data-field="str"]');
            const metaEl = div.querySelector('[data-field="meta"]');

            if (subEl) subEl.textContent = item.sub;
            if (strEl) strEl.textContent = item.str;
            if (metaEl) metaEl.textContent = `${item.form} | ${formatSizeDisplay(item.size)}`;

            div.onclick = function () {
                document.getElementById('sub-input').value = item.sub + ' ' + item.str;
                dropdown.style.display = "none";
                
                // Använd ID:n från indexet för en exakt och snabb sökning i data-filen
                fetchLatestPV(item); 
            };
            listContainer.appendChild(itemTemplate);
        });
        dropdown.style.display = "block";
    } else {
        // Show no results message in dropdown
        const noResultsTemplate = cloneTemplate('template-dropdown-no-results');
        if (noResultsTemplate) {
            listContainer.appendChild(noResultsTemplate);
        }
        dropdown.style.display = "block";
    }
};

document.getElementById('sub-input').onfocus = function () {
    const searchTerm = this.value.toLowerCase().trim();
    if (searchTerm.length >= 2) {
        this.oninput();
    }
};

document.getElementById('clear-search').onclick = function () {
    const input = document.getElementById('sub-input');
    const dropdown = document.getElementById('custom-select');
    input.value = '';
    this.style.display = 'none';
    dropdown.style.display = 'none';
    input.focus();
};

document.querySelectorAll('.popular-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
        const input = document.getElementById('sub-input');
        if (!input) return;
        
        // Remove selection state to allow new search
        document.body.classList.remove('has-selection');
        
        // Set the input value and trigger search after a brief delay
        input.value = chip.dataset.search || '';
        
        // Use setTimeout to ensure the class removal takes effect
        setTimeout(() => {
            input.dispatchEvent(new Event('input'));
            input.focus();
        }, 10);
    });
});

// Keyboard navigation for search dropdown
let selectedDropdownIndex = -1;
let lastDropdownMatches = [];
let originalSearchInput = '';

document.getElementById('sub-input').onkeydown = function (e) {
    const dropdown = document.getElementById('custom-select');
    const listContainer = document.getElementById('package-list');
    const items = listContainer.querySelectorAll('.dropdown-item');
    
    if (dropdown.style.display === 'none') return;
    
    switch(e.key) {
        case 'ArrowDown':
            e.preventDefault();
            selectedDropdownIndex = Math.min(selectedDropdownIndex + 1, items.length - 1);
            highlightDropdownItem(items, selectedDropdownIndex);
            updateInputFromSelection(selectedDropdownIndex);
            break;
        case 'ArrowUp':
            e.preventDefault();
            selectedDropdownIndex = Math.max(selectedDropdownIndex - 1, -1);
            highlightDropdownItem(items, selectedDropdownIndex);
            updateInputFromSelection(selectedDropdownIndex);
            break;
        case 'Enter':
            e.preventDefault();
            if (selectedDropdownIndex >= 0 && selectedDropdownIndex < items.length) {
                items[selectedDropdownIndex].click();
                selectedDropdownIndex = -1;
            }
            break;
        case 'Escape':
            dropdown.style.display = 'none';
            selectedDropdownIndex = -1;
            document.getElementById('sub-input').value = originalSearchInput;
            if (!originalSearchInput) {
                currentSearch = null;
                document.body.classList.remove('has-selection');
            }
            break;
    }
};

function updateInputFromSelection(index) {
    const input = document.getElementById('sub-input');
    if (index >= 0 && index < lastDropdownMatches.length) {
        input.value = lastDropdownMatches[index].sub + ' ' + lastDropdownMatches[index].str;
    } else {
        input.value = originalSearchInput;
    }
}

function highlightDropdownItem(items, index) {
    items.forEach((item, i) => {
        if (i === index) {
            item.style.background = '#eff6ff';
            item.style.cursor = 'pointer';
            item.scrollIntoView({ block: 'nearest' });
        } else {
            item.style.background = '';
        }
    });
}


async function fetchLatestPV(searchItem) {
    currentSearch = searchItem;
    
    // Hide hero content and show search bar for medicine selection
    document.body.classList.add('has-selection');
    
    const resultsDiv = document.getElementById('results');
    replaceContent(resultsDiv, cloneTemplate('template-loading'));

    try {
        const res = await fetch(`data/${selectedMonth}.json`);
        const data = await res.json();
        
        let matches = data.filter(i => 
            String(i["Utbytesgrupps ID"]) === String(searchItem.id) &&
            String(i["Förpackningsstorleksgrupp"]) === String(searchItem.size_id)
        );

        if (matches.length === 0) {
            replaceContent(resultsDiv, cloneTemplate('template-no-results'));
            return;
        }

        lastMatches = matches.sort((a, b) => {
            const getPriority = (s) => {
                const status = getItemStatus(s).trim().toUpperCase();
                if (status === "PV") return 1;
                if (status.startsWith("R")) return parseInt(status.substring(1)) + 1;
                return 100;
            };
            return getPriority(a.Status) - getPriority(b.Status);
        });

        // Hitta PV och det absoluta lägsta priset
        const pvProduct = lastMatches.find(i => getItemStatus(i).trim().toUpperCase() === "PV") || lastMatches[0];
        lastPVPrice = pvProduct["Försäljningspris"];
        const absoluteMinPrice = Math.min(...matches.map(i => i["Försäljningspris"]));

        // Beräkna sparande och hitta den billigaste produkten
        const savings = lastPVPrice - absoluteMinPrice;
        // Vi visar bara alerten om man sparar minst 1 kr (för att slippa avrundningsdiffar)
        const cheaperProduct = savings >= 1 ? lastMatches.find(i => i["Försäljningspris"] === absoluteMinPrice) : null;

        const stats = await getPriceStatistics(searchItem);

        replaceContent(resultsDiv, cloneTemplate('template-results-container'));

        const chartCont = document.getElementById('chart-container');
        if (chartCont) {
            chartCont.style.display = "block";
            chartCont.className = "bleed-card";
        }

        // Show month picker button when viewing medicine
        showMonthPicker();

        // Skicka med spar-data till renderaren
        await renderPriceCard(pvProduct, searchItem.sub, searchItem.str, searchItem.form, stats, cheaperProduct, savings);
        
        // Create and inject month warning banner after price card is rendered
        createMonthBanner(resultsDiv);
        
        renderTableOnly(); 
        renderHistoryChart(searchItem);

        // Visa info-boxen endast om PV inte är billigast (efter renderTableOnly som skapar den)
        if (!cheaperProduct) {
            const infoBox = document.querySelector('.tlv-info-box');
            if (infoBox) {
                infoBox.classList.add('hidden');
            }
        }

        updateMonthBanner();

    } catch (err) {
        console.error("Fel vid hämtning av detaljer:", err);
        replaceContent(resultsDiv, cloneTemplate('template-error'));
    }
}

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
                getItemStatus(i).trim().toUpperCase() === "PV"
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

async function renderPriceCard(pvProduct, sub, str, form, stats, cheaperProduct, savings) {
    const area = document.getElementById('price-card-area');
    if (!pvProduct || !area) return;

    const formatPrice = (p) => new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK" }).format(p);

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
                getItemStatus(i).trim().toUpperCase() === "PV"
            );
            return match ? match["Försäljningspris"] : null;
        } catch (e) { return null; }
    }

    const prevPrice = await fetchSpecificPrice(prevMonthCode);
    const nextPrice = await fetchSpecificPrice(nextMonthCode);
    const rec = getPriceRecommendation(pvProduct["Försäljningspris"], stats, nextPrice);

    const createStatBlock = (price, label, currentPrice, monthCode, isFuture) => {
        const fragment = cloneTemplate('template-stat-block');
        if (!fragment) return null;
        const block = fragment.querySelector('.stat-block');
        const labelEl = block.querySelector('.stat-block-label');
        const priceEl = block.querySelector('.stat-block-price');
        const trendEl = block.querySelector('.stat-block-trend');
        const trendIcon = block.querySelector('.stat-block-trend .material-symbols-outlined');
        const trendValue = block.querySelector('.stat-block-trend-value');
        const emptyEl = block.querySelector('.stat-block-empty');

        let prelimIconEl = null;
        if (isFuture && isPrelimMonth(monthCode)) {
            prelimIconEl = document.createElement('span');
            prelimIconEl.className = 'prelim-info';
            prelimIconEl.setAttribute('tabindex', '0');
            prelimIconEl.setAttribute('role', 'button');
            prelimIconEl.setAttribute('aria-label', 'Preliminärt pris');
            prelimIconEl.setAttribute('data-tooltip', 'Priset är preliminärt och kan komma att ändras');
            prelimIconEl.textContent = '!';
        }

        labelEl.textContent = label;
        if (prelimIconEl) {
            labelEl.append(' ');
            labelEl.appendChild(prelimIconEl);
        }

        if (!price) {
            trendEl.style.display = 'none';
            priceEl.style.display = 'none';
            emptyEl.style.display = 'block';
            return block;
        }

        const diff = price - currentPrice;
        const diffPercent = Math.round((Math.abs(diff) / currentPrice) * 100);
        const isStable = diffPercent <= 2; // Consider <= 2% as stable
        
        // Default to CSS variable color, or use semantic colors for significant changes
        let priceColor = "", trendColor = "#64748b", icon = "horizontal_rule";

        if (price !== currentPrice) {
            // Determine icon based on direction
            icon = isFuture === (price > currentPrice) ? "trending_up" : "trending_down";
            
            if (!isStable) {
                // Significant change - use color coding
                if (!isFuture) {
                    priceColor = price > currentPrice ? "#dc2626" : "#16a34a";
                    trendColor = price > currentPrice ? "#16a34a" : "#dc2626";
                } else {
                    priceColor = price > currentPrice ? "#dc2626" : "#16a34a";
                    trendColor = priceColor;
                }
            } else {
                // Stable price - use default (CSS will apply --text-primary)
                priceColor = "";
                trendColor = "#64748b";
            }
        } else {
            trendEl.style.display = 'none';
        }

        priceEl.textContent = formatPrice(price);
        if (priceColor) {
            priceEl.style.color = priceColor;
        } else {
            priceEl.style.color = ''; // Clear inline style to use CSS
        }
        trendEl.style.background = `${trendColor}15`;
        trendEl.style.color = trendColor;
        trendIcon.textContent = icon;
        trendValue.textContent = `${diffPercent}%`;

        return block;
    };

    const cardTemplate = cloneTemplate('template-price-card');
    replaceContent(area, cardTemplate);

    const headerBar = area.querySelector('.price-card-header-bar');
    
    // If no recommendation (viewing historical month), hide the header bar
    if (!rec) {
        headerBar.style.display = 'none';
    } else {
        headerBar.style.display = 'flex';
        
        // Use dark mode compatible background
        const isDarkMode = document.body.classList.contains('dark-mode');
        headerBar.style.background = isDarkMode ? 'var(--card-bg)' : rec.bg;
        
        // Add border for dark mode to show color indication
        if (isDarkMode) {
            headerBar.style.border = `2px solid ${rec.color}`;
        } else {
            headerBar.style.border = '';
        }

        const headerIcon = area.querySelector('.price-card-icon');
        headerIcon.textContent = rec.icon;
        headerIcon.style.color = rec.color;

        const headerLabel = area.querySelector('.price-card-header-label');
        headerLabel.textContent = `${rec.label}!`;
        headerLabel.style.color = isDarkMode ? 'var(--text-primary)' : rec.color;

        const headerSubtext = area.querySelector('.price-card-header-subtext');
        headerSubtext.textContent = rec.subtext;
        headerSubtext.style.color = isDarkMode ? 'var(--text-secondary)' : rec.color;
    }

    area.querySelector('.price-card-title').textContent = pvProduct.Produktnamn;
    area.querySelector('.price-card-subtitle').textContent = `${sub} · ${str} · ${form}`;
    area.querySelector('.price-card-current-value').textContent = formatPrice(pvProduct["Försäljningspris"]);

    const savingsSlot = area.querySelector('.price-card-savings-slot');
    if (cheaperProduct && savings >= 1) {
        const savingsTpl = cloneTemplate('template-savings-alert');
        if (savingsTpl) {
            const savingsNode = savingsTpl.querySelector('.savings-alert-box');
            const title = savingsNode.querySelector('.savings-alert-title');
            const text = savingsNode.querySelector('.savings-alert-text');
            title.textContent = `Spara ${savings.toFixed(2).replace('.', ',')} kr!`;
            text.textContent = '';
            const strong = document.createElement('strong');
            strong.textContent = cheaperProduct.Produktnamn;
            text.appendChild(strong);
            text.append(' är billigare än Periodens Vara.');
            savingsSlot.appendChild(savingsNode);
        }
    }

    const statContainer = area.querySelector('.stat-blocks-container');
    
    // Always show prev/next month blocks if data exists
    statContainer.style.display = 'flex';
    const prevBlock = createStatBlock(prevPrice, "Förra månaden", pvProduct["Försäljningspris"], prevMonthCode, false);
    const nextBlock = createStatBlock(nextPrice, "Nästa månad", pvProduct["Försäljningspris"], nextMonthCode, true);
    if (prevBlock) statContainer.appendChild(prevBlock);
    if (nextBlock) statContainer.appendChild(nextBlock);
    
    // Hide container only if no blocks were added
    if (statContainer.children.length === 0) {
        statContainer.style.display = 'none';
    }

    const packagingValue = (() => {
        const map = currentSearch?.packagingMap || {};
        const vnr = pvProduct.Varunummer ?? pvProduct.Vnr;
        const byVnr = map[vnr] || map[String(vnr)];
        return pvProduct.Förpackning
            || byVnr
            || (currentSearch?.packaging && currentSearch.packaging[0])
            || pvProduct.Beredningsform
            || pvProduct.Läkemedelsform
            || '-';
    })();

    const packSizeEl = area.querySelector('[data-field="pack-size"]');
    const packagingEl = area.querySelector('[data-field="packaging"]');
    const manufacturerEl = area.querySelector('[data-field="manufacturer"]');
    const originEl = area.querySelector('[data-field="origin"]');

    if (packSizeEl) packSizeEl.textContent = formatUnit(form, pvProduct.Storlek);
    if (packagingEl) packagingEl.textContent = packagingValue;
    if (manufacturerEl) manufacturerEl.textContent = pvProduct.Företag || '—';
    if (originEl) originEl.textContent = pvProduct.Ursprung || 'Generics';
}

function renderTableOnly() {
    const area = document.getElementById('table-area');
    if (!area) return;

    const template = cloneTemplate('template-table-container');
    replaceContent(area, template);
    const strong = area.querySelector('.comparison-subtitle-strong');
    if (strong) {
        strong.textContent = `${currentSearch.sub} ${currentSearch.str}`;
    }

    updateTableRows(lastMatches);
}

function updateTableRows(data) {
    const container = document.getElementById('comparison-list');
    const footer = document.getElementById('pagination-footer');
    if (!container) return;

    const minPriceInData = Math.min(...data.map(item => item["Försäljningspris"]));
    const rowsToShow = (data.length > 5 && !isExpanded) ? data.slice(0, 5) : data;

    // Add expand/collapse button if there are more than 5 items
    if (data.length > 5) {
        const buttonText = isExpanded ? 'Visa färre' : `Visa alla (${data.length})`;
        const footerHtml = `
            <div style="text-align: center; padding: 16px 0; margin-top: 8px;">
                <a onclick="toggleTableExpansion()" style="color: #0891b2; font-size: 13px; cursor: pointer; font-weight: 500; text-decoration: none; transition: color 0.2s;" onmouseover="this.style.color='#0369a1'" onmouseout="this.style.color='#0891b2'">
                    ${buttonText}
                </a>
            </div>
        `;
        footer.innerHTML = footerHtml;
    } else {
        footer.innerHTML = '';
    }

    container.innerHTML = '';
    
    rowsToShow.forEach((item, index) => {
        const itemPrice = item["Försäljningspris"];
        const diff = itemPrice - lastPVPrice;
        const status = getItemStatus(item).trim().toUpperCase();
        // Robust rad-ID även när Vnr saknas
        const rowId = String(
            item.Vnr ?? `${(item.Produktnamn || '')}-${(item.Företag || '')}-${(item.Storlek || '')}-${index}`
        );
        
        // Enhetslogik
        const form = (item.Läkemedelsform || "").toLowerCase();
        const size = item.Storlek || "";
        let unit = "st";
        if (form.includes("gel") || form.includes("salva") || form.includes("kräm")) unit = "g";
        else if (form.includes("droppar") || form.includes("lösning")) unit = "ml";

        const isPV = status === "PV";
        const isR1 = status === "R1";
        const isR2 = status === "R2";
        const isCheapest = itemPrice === minPriceInData;
        const isOpen = selectedRowId === rowId;

        // PV is blue unless it's also cheapest (then green)
        const isPVAndCheapest = isPV && isCheapest;

        let statusBadgeHtml = "";
        if (isPVAndCheapest) {
            statusBadgeHtml = `<span class="status-badge-mini badge-pv">PV</span><span class="status-badge-mini" style="color: #16a34a; border: 1px solid #10b981;"><span class="material-symbols-outlined" style="font-size: 14px;">star</span></span>`;
        } else if (isPV) {
            statusBadgeHtml = `<span class="status-badge-mini badge-pv">PV</span>`;
        } else if (isR1 || isR2) {
            statusBadgeHtml = `<span class="status-badge-mini badge-reserve">${status}</span>`;
        } else if (isCheapest) {
            statusBadgeHtml = `<span class="status-badge-mini" style="color: #16a34a; border: 1px solid #10b981;"><span class="material-symbols-outlined" style="font-size: 14px;">star</span></span>`;
        }

        const rowClass = isCheapest ? 'cheapest-row' : (isPV ? 'pv-row' : (isR1 || isR2 ? 'reserve-row' : 'default-row'));
        const priceDiffStyle = diff > 0 ? 'color: #dc2626;' : '';
        const priceDiffText = diff === 0 ? 'PV' : (diff > 0 ? `+${diff.toFixed(2)} kr` : `${diff.toFixed(2)} kr`);

        const rowFragment = cloneTemplate('template-comparison-row');
        const rowDiv = rowFragment.querySelector('.comparison-row');
        
        rowDiv.setAttribute('onclick', `toggleRowDetails('${rowId}')`);
        rowDiv.classList.add(rowClass);
        
        replaceContent(rowDiv, '.comparison-row-status', statusBadgeHtml);
        replaceContent(rowDiv, '.comparison-row-name', item.Produktnamn);
        replaceContent(rowDiv, '.comparison-row-info', `${item.Företag} · ${size} ${unit}`);
        replaceContent(rowDiv, '.price-value', `${itemPrice.toLocaleString('sv-SE', { minimumFractionDigits: 2 })} kr`);
        replaceContent(rowDiv, '.price-diff', priceDiffText);
        
        const priceDiffEl = rowDiv.querySelector('.price-diff');
        if (priceDiffEl && priceDiffStyle) {
            priceDiffEl.setAttribute('style', priceDiffStyle);
        }

        if (isOpen) {
            const map = currentSearch?.packagingMap || {};
            const vnr = item.Varunummer ?? item.Vnr;
            const byVnr = map[vnr] || map[String(vnr)];
            const forpackning = item["Förpackning"]
                || byVnr
                || (currentSearch?.packaging && currentSearch.packaging[0])
                || item["Beredningsform"]
                || item["Läkemedelsform"]
                || '—';

            const detailsFragment = cloneTemplate('template-row-details');
            const detailsDiv = detailsFragment.querySelector('.row-details-container');
            const detailItems = detailsDiv.querySelectorAll('.row-detail-item');
            
            replaceContent(detailItems[0], '.row-detail-value', `${size} ${unit}`);
            replaceContent(detailItems[1], '.row-detail-value', forpackning);
            replaceContent(detailItems[2], '.row-detail-value', item.Företag || '—');
            replaceContent(detailItems[3], '.row-detail-value', item.Ursprung || 'Generics');

            rowDiv.appendChild(detailsDiv);
        }

        container.appendChild(rowFragment);
    });

}

function renderMonthSelector() {
    const fragment = cloneTemplate('template-month-selector');
    const select = fragment.querySelector('#month-select');
    
    availableMonths.forEach(m => {
        const option = document.createElement('option');
        option.value = m;
        option.textContent = `${formatMedicineDate(m)}${isPrelimMonth(m) ? ' (Preliminär)' : ''}`;
        if (m == selectedMonth) {
            option.selected = true;
        }
        select.appendChild(option);
    });
    
    const tempDiv = document.createElement('div');
    tempDiv.appendChild(fragment);
    return tempDiv.innerHTML;
}

function updateMonth(newMonth) {
    selectedMonth = newMonth;
    
    // Update header with new month
    const headerPeriod = document.getElementById('header-period');
    if (headerPeriod) {
        const prelimTag = isPrelimMonth(selectedMonth) ? " • Preliminär" : "";
        headerPeriod.textContent = `TLV Periodens Varor • ${formatMedicineDate(selectedMonth)}${prelimTag}`;
    }
    
    updateMonthBanner();
    
    if (currentSearch) {
        isExpanded = false; 
        fetchLatestPV(currentSearch); // Skicka hela objektet
    }
}

function createMonthBanner(container) {
    // Remove existing banner if present
    const existingBanner = document.getElementById('month-warning-banner');
    if (existingBanner) {
        existingBanner.remove();
    }

    // Create new banner
    const banner = document.createElement('div');
    banner.id = 'month-warning-banner';
    banner.className = 'month-warning-banner';
    banner.innerHTML = `
        <div class="month-banner-icon-wrapper">
            <span class="material-symbols-outlined month-banner-icon">calendar_month</span>
        </div>
        <div class="month-banner-text">
            <span class="month-banner-label">Du visar nu priset för <b class="banner-month-name"></b>.</span>
            <span class="month-banner-action">Klicka <b onclick="goToCurrentMonth()">här</b> för att gå till nuvarande månad.</span>
        </div>
    `;
    
    // Insert right after the header bar (between header and content wrapper)
    const headerBar = document.querySelector('.price-card-header-bar');
    if (headerBar) {
        headerBar.insertAdjacentElement('afterend', banner);
    } else {
        // Fallback: insert into price-card-area
        const priceCardArea = document.getElementById('price-card-area');
        if (priceCardArea) {
            priceCardArea.insertBefore(banner, priceCardArea.firstChild);
        }
    }
    
    // Update visibility based on current month
    updateMonthBanner();
}

function updateMonthBanner() {
    const banner = document.getElementById('month-warning-banner');
    if (!banner) return;
    
    if (selectedMonth !== systemMonthCode) {
        banner.style.display = 'flex';
        const monthNameEl = banner.querySelector('.banner-month-name');
        if (monthNameEl) {
            monthNameEl.textContent = formatMedicineDate(selectedMonth);
        }
    } else {
        banner.style.display = 'none';
    }
}

function goToCurrentMonth() {
    updateMonth(systemMonthCode);
}

function toggleTableExpansion() {
    isExpanded = !isExpanded;
    
    // Vi skickar med den sparade datan direkt till rad-renderaren
    updateTableRows(lastMatches);
}

function toggleRowDetails(vnr) {
    // Om vi klickar på samma rad igen, stäng den. Annars öppna den nya.
    selectedRowId = (selectedRowId === vnr) ? null : vnr;
    
    // Vi anropar updateTableRows direkt för att rita om listan med den nya selectedRowId
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

function isPrelimMonth(monthCode) {
    const code = Number(monthCode);
    if (!code || !systemMonthCode) return false;
    return code > systemMonthCode;
}

function renderInfoCard(item) {
    const area = document.getElementById('info-card-area');
    if (!area) return;

    const infoTemplate = cloneTemplate('template-info-card');
    if (!infoTemplate) return;
    replaceContent(area, infoTemplate);

    const exchangeGroup = area.querySelector('[data-field="exchange-group"]');
    const productNumbers = area.querySelector('[data-field="product-numbers"]');
    const synonyms = area.querySelector('[data-field="synonyms"]');

    if (exchangeGroup) exchangeGroup.textContent = item?.id ?? '—';
    if (productNumbers) productNumbers.textContent = Array.isArray(item?.vnr) ? item.vnr.join(', ') : (item?.vnr ?? '—');
    if (synonyms) synonyms.textContent = Array.isArray(item?.names) ? item.names.join(', ') : (item?.names ?? '—');
}

function renderInsightCard(pvPrice, stats, nextPrice) {
    const area = document.getElementById('insight-card-area');
    if (!area || !stats) return;

    // Här kan du lägga till den analyzeMarketData-logik vi tittade på tidigare
    const insightTemplate = cloneTemplate('template-insight-card');
    if (!insightTemplate) return;
    replaceContent(area, insightTemplate);

    const avgPriceEl = area.querySelector('[data-field="avg-price"]');
    const minPriceEl = area.querySelector('[data-field="min-price"]');

    if (avgPriceEl) avgPriceEl.textContent = `${stats.avgPrice.toFixed(2)} kr`;
    if (minPriceEl) minPriceEl.textContent = `${stats.minPrice.toFixed(2)} kr`;
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

function formatSizeDisplay(size) {
    if (!size) return size;
    // Check if it's a range like "28-32"
    const match = size.match(/(\d+)\s*-\s*(\d+)/);
    if (match) {
        const min = parseInt(match[1]);
        const max = parseInt(match[2]);
        const avg = Math.round((min + max) / 2);
        return `ca ${avg}`;
    }
    return size;
}

async function renderHistoryChart(searchItem) {
    const canvas = document.getElementById('priceChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const container = document.getElementById('chart-container');
    const rangeSelect = document.getElementById('chart-range-select');
    const priceTypeSelect = document.getElementById('chart-price-type');
    const rangeVal = rangeSelect ? rangeSelect.value : "12";
    
    // Update global chart price type
    if (priceTypeSelect) {
        chartPriceType = priceTypeSelect.value;
    }
    
    if (window.myChart instanceof Chart) {
        window.myChart.destroy();
    }

    let filteredMonths = [...availableMonths];
    if (rangeVal !== "all") {
        const limit = parseInt(rangeVal);
        // Check if it's a year selection (4 digits starting with 2)
        if (rangeVal.length === 4 && rangeVal.startsWith('2')) {
            const yearPrefix = rangeVal.slice(2); // "26" from "2026"
            filteredMonths = filteredMonths.filter(m => String(m).startsWith(yearPrefix));
        } else {
            // It's a number of months
            filteredMonths = filteredMonths.slice(0, limit);
        }
    }

    const chronologicalMonths = filteredMonths.reverse();
    let historyPoints = [];
    const stats = await getPriceStatistics(searchItem);
    
    for (const month of chronologicalMonths) {
        try {
            const res = await fetch(`data/${month}.json`);
            const data = await res.json();
            
            let match;
            if (chartPriceType === "cheapest") {
                // Find cheapest price for this exchange group and size
                const allMatches = data.filter(i => 
                    String(i["Utbytesgrupps ID"]) === String(searchItem.id) &&
                    String(i["Förpackningsstorleksgrupp"]) === String(searchItem.size_id)
                );
                if (allMatches.length > 0) {
                    match = allMatches.reduce((min, curr) => 
                        curr["Försäljningspris"] < min["Försäljningspris"] ? curr : min
                    );
                }
            } else {
                // Find PV (Periodens vara)
                match = data.find(i => 
                    String(i["Utbytesgrupps ID"]) === String(searchItem.id) &&
                    String(i["Förpackningsstorleksgrupp"]) === String(searchItem.size_id) &&
                    getItemStatus(i).trim().toUpperCase() === "PV"
                );
            }
            
            if (match) {
                const price = match["Försäljningspris"];
                const diffFromAvg = stats ? ((price - stats.avgPrice) / stats.avgPrice) * 100 : 0;
                historyPoints.push({
                    x: formatMedicineDate(month),
                    y: price,
                    company: match.Företag,
                    diff: diffFromAvg.toFixed(1),
                    monthCode: month
                });
            }
        } catch (e) {}
    }

    if (historyPoints.length === 0) {
        container.style.display = "none";
        return;
    }

    container.style.display = "block";

    // --- NY LOGIK FÖR ATT MOTVERKA DRAMATISK GRAF ---
    const allPrices = historyPoints.map(p => p.y);
    const minPrice = Math.min(...allPrices);
    const maxPrice = Math.max(...allPrices);
    const priceDiff = maxPrice - minPrice;

    // Vi vill att y-axeln alltid ska visa ett spann på minst 60 kr (eller mer om priset varierar mer)
    // Detta gör att småändringar på 2-5 kr ser flacka och "normala" ut.
    const minSpan = 60; 
    let yMin = minPrice - 10; // Standard: 10 kr marginal under
    let yMax = maxPrice + 10; // Standard: 10 kr marginal över

    if (priceDiff < minSpan) {
        const paddingNeeded = (minSpan - priceDiff) / 2;
        yMin = Math.max(0, minPrice - paddingNeeded); // Gå inte under 0 kr
        yMax = maxPrice + paddingNeeded;
    }

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
                pointRadius: 4,
                tension: 0.3,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { 
                    // Applicera det beräknade spannet
                    min: Math.floor(yMin / 5) * 5, // Avrunda neråt till närmsta 5-lapp för snyggare skala
                    max: Math.ceil(yMax / 5) * 5,  // Avrunda uppåt till närmsta 5-lapp
                    ticks: { 
                        callback: (v) => v + ' kr',
                        stepSize: 10, // Gör skalan lugnare med fasta steg
                        color: document.body.classList.contains('dark-mode') ? '#94a3b8' : '#64748b'
                    },
                    grid: { 
                        color: document.body.classList.contains('dark-mode') ? '#334155' : '#e2e8f0'
                    }
                },
                x: { 
                    ticks: { 
                        maxRotation: 45, 
                        minRotation: 45, 
                        font: { size: 11 },
                        color: document.body.classList.contains('dark-mode') ? '#94a3b8' : '#64748b'
                    },
                    grid: { display: false }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    padding: 12,
                    callbacks: {
                        label: function(context) {
                            const point = historyPoints[context.dataIndex];
                            return [
                                ` Pris: ${point.y.toLocaleString('sv-SE')} kr`,
                                ` Företag: ${point.company}`,
                                '',
                                ' 💡 Klicka för att gå till månad'
                            ];
                        }
                    }
                }
            },
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const dataIndex = elements[0].index;
                    const point = historyPoints[dataIndex];
                    if (point && point.monthCode) {
                        updateMonth(point.monthCode);
                        window.scrollTo(0, 0);
                        fetchLatestPV(currentSearch);
                    }
                }
            }
        }
    });

    // Lägg till prisstabilitetsanalys under grafen
    renderPriceStabilityInsight(allPrices, minPrice, maxPrice, priceDiff);
}

function renderPriceStabilityInsight(allPrices, minPrice, maxPrice, priceDiff) {
    const chartContainer = document.getElementById('chart-container');
    if (!chartContainer) return;

    // Ta bort tidigare insight om den finns
    const existingInsight = document.getElementById('stability-insight');
    if (existingInsight) existingInsight.remove();

    const avgPrice = allPrices.reduce((a, b) => a + b, 0) / allPrices.length;
    const variance = allPrices.reduce((sum, price) => sum + Math.pow(price - avgPrice, 2), 0) / allPrices.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = (stdDev / avgPrice) * 100; // CV i procent

    let stabilityLabel, stabilityColor, stabilityIcon, stabilityText, stabilityBg;

    if (coefficientOfVariation < 3) {
        stabilityLabel = "Mycket stabilt pris";
        stabilityColor = "#16a34a";
        stabilityIcon = "check_circle";
        stabilityText = `Priset har varit mycket stabilt med minimal variation (±${coefficientOfVariation.toFixed(1)}%).`;
        stabilityBg = "#f0fdf4";
    } else if (coefficientOfVariation < 8) {
        stabilityLabel = "Stabilt pris";
        stabilityColor = "#0891b2";
        stabilityIcon = "trending_flat";
        stabilityText = `Priset har varit relativt stabilt med låg variation (±${coefficientOfVariation.toFixed(1)}%).`;
        stabilityBg = "#ecfeff";
    } else if (coefficientOfVariation < 15) {
        stabilityLabel = "Måttlig prisvariation";
        stabilityColor = "#f59e0b";
        stabilityIcon = "swap_vert";
        stabilityText = `Priset varierar måttligt mellan ${minPrice.toFixed(2)} kr och ${maxPrice.toFixed(2)} kr.`;
        stabilityBg = "#fffbeb";
    } else {
        stabilityLabel = "Volatilt pris";
        stabilityColor = "#dc2626";
        stabilityIcon = "warning";
        stabilityText = `Priset har varierat kraftigt med ${priceDiff.toFixed(2)} kr skillnad mellan lägsta och högsta pris.`;
        stabilityBg = "#fef2f2";
    }

    const isDarkMode = document.body.classList.contains('dark-mode');
    const bgStyle = isDarkMode ? 'var(--card-bg)' : stabilityBg;
    const borderStyle = isDarkMode ? `2px solid ${stabilityColor}` : `1px solid ${stabilityColor}30; border-left: 4px solid ${stabilityColor}`;
    
    const insightHtml = `
        <div id="stability-insight" class="stability-insight-box" style="background: ${bgStyle}; border: ${borderStyle};">
            <span class="material-symbols-outlined stability-insight-icon" style="color: ${stabilityColor};">${stabilityIcon}</span>
            <div>
                <strong class="stability-insight-title" style="color: ${isDarkMode ? 'var(--text-primary)' : stabilityColor};">${stabilityLabel}</strong>
                <p class="stability-insight-text">${stabilityText}</p>
            </div>
        </div>
    `;

    chartContainer.insertAdjacentHTML('beforeend', insightHtml);
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

    // If viewing historical month, return null (no recommendation)
    if (selectedMonth !== systemMonthCode) {
        return null;
    }

    let rec = {
        label: "Normalt pris",
        color: "#64748b",
        icon: "balance",
        bg: "#f8fafc",
        subtext: "Priset är i linje med det historiska snittet.",
        urgency: 0
    };

    // --- 1. ANALYS AV FRAMTIDA PRIS ---
    if (nextPrice !== null && nextPrice !== undefined) {
        const diffNext = nextPrice - currentPrice;
        const diffNextPercent = (diffNext / currentPrice) * 100;

        // Kräv minst 5% skillnad OCH minst 15 kr i prisskillnad
        if (diffNextPercent >= 5 && diffNext >= 15) {
            rec = {
                label: "Köp nu – Prishöjning väntar",
                color: "#c2410c",
                icon: "shopping_cart_checkout",
                bg: "#fff7ed",
                subtext: `Priset beräknas stiga med ${Math.abs(diffNext).toFixed(2)} kr nästa månad.`,
                urgency: 3
            };
        } else if (diffNextPercent <= -5 && Math.abs(diffNext) >= 15) {
            rec = {
                label: "Vänta – Sänkning på väg",
                color: "#7c3aed",
                icon: "hourglass_empty",
                bg: "#f5f3ff",
                subtext: `Priset beräknas sänkas med ${Math.abs(diffNext).toFixed(2)} kr nästa månad.`,
                urgency: 3
            };
        }
    }

    // --- 2. HISTORISK ANALYS ---
    if (rec.urgency < 3 && avgPrice) {
        const diffAvg = currentPrice - avgPrice;
        const diffAvgPercent = (diffAvg / avgPrice) * 100;
        const absDiffAvg = Math.abs(diffAvg); // Skillnad i kronor
        const priceRange = maxPrice - minPrice; // Total prisspridning

        // "Fyndläge" kräver både att priset är nära minimum OCH att det finns en betydande prisspridning
        const isNearMin = minPrice && currentPrice <= minPrice * 1.02; 
        const hasSignificantRange = priceRange > avgPrice * 0.10; // Minst 10% spridning
        
        // Ovanligt högt kräver nu: Nära max ELLER >20% över snitt, SAMT minst 15 kr dyrare än snitt
        const isHigh = (currentPrice >= maxPrice * 0.95 || diffAvgPercent > 20) && diffAvg >= 15;

        if (isNearMin && hasSignificantRange) {
            rec = {
                label: "Historiskt fyndläge",
                color: "#16a34a",
                icon: "auto_awesome",
                bg: "#f0fdf4",
                subtext: "Detta är ett av de lägsta priserna som noterats det senaste året.",
                urgency: 2
            };
        } else if (diffAvgPercent < -15 && absDiffAvg >= 15) {
            rec = {
                label: "Mycket bra pris",
                color: "#15803d",
                icon: "thumb_up",
                bg: "#f0fdf4",
                subtext: `Ca ${absDiffAvg.toFixed(0)} kr billigare än genomsnittet.`,
                urgency: 2
            };
        } else if (isHigh) {
            rec = {
                label: "Ovanligt högt pris",
                color: "#dc2626",
                icon: "error",
                bg: "#fef2f2",
                subtext: "Priset är betydligt högre än genomsnittet just nu.",
                urgency: 2
            };
        } else if (diffAvgPercent > 8 && diffAvg >= 15) {
            rec = {
                label: "Något dyrt just nu",
                color: "#b45309",
                icon: "trending_up",
                bg: "#fffbeb",
                subtext: `Priset ligger ${absDiffAvg.toFixed(0)} kr över snittet.`,
                urgency: 1
            };
        }
    }

    return rec;
}

// Month Picker Functions
let currentPickerYear = Math.floor(selectedMonth / 100);

function showMonthPicker() {
    const btn = document.getElementById('month-picker-btn');
    if (btn) {
        btn.style.display = 'block';
        currentPickerYear = Math.floor(selectedMonth / 100);
        populateMonthPicker();
    }
}

function populateMonthPicker() {
    const yearEl = document.getElementById('month-picker-year');
    const grid = document.getElementById('month-picker-grid');
    const prevBtn = document.getElementById('prev-year-btn');
    const nextBtn = document.getElementById('next-year-btn');
    
    if (!yearEl || !grid) return;
    
    // Get available years from month codes (e.g., 2602 -> 26 -> 2026)
    const availableYears = [...new Set(availableMonths.map(m => Math.floor(m / 100)))].sort();
    const minYear = Math.min(...availableYears);
    const maxYear = Math.max(...availableYears);
    
    // Update year display
    yearEl.textContent = '20' + String(currentPickerYear).padStart(2, '0');
    
    // Enable/disable navigation buttons
    if (prevBtn) prevBtn.disabled = currentPickerYear <= minYear;
    if (nextBtn) nextBtn.disabled = currentPickerYear >= maxYear;
    
    grid.innerHTML = '';
    
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];
    
    // Create grid for all 12 months
    months.forEach((monthName, index) => {
        const monthNum = String(index + 1).padStart(2, '0');
        const monthCode = parseInt(String(currentPickerYear) + monthNum);
        
        const monthDiv = document.createElement('div');
        monthDiv.className = 'month-picker-month';
        monthDiv.textContent = monthName;
        
        // Check if this month is available
        if (availableMonths.includes(monthCode)) {
            monthDiv.classList.add('available');
            
            if (monthCode == selectedMonth) {
                monthDiv.classList.add('selected');
            }
            if (isPrelimMonth(monthCode)) {
                monthDiv.classList.add('prelim');
            }
            
            monthDiv.onclick = () => {
                document.getElementById('month-picker-dropdown').style.display = 'none';
                updateMonth(monthCode);
                if (currentSearch) {
                    fetchLatestPV(currentSearch);
                }
            };
        } else {
            monthDiv.classList.add('unavailable');
        }
        
        grid.appendChild(monthDiv);
    });
}

// Toggle month picker dropdown
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('month-picker-btn');
    const dropdown = document.getElementById('month-picker-dropdown');
    const prevBtn = document.getElementById('prev-year-btn');
    const nextBtn = document.getElementById('next-year-btn');
    
    if (btn && dropdown) {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = dropdown.style.display === 'block';
            dropdown.style.display = isVisible ? 'none' : 'block';
            if (!isVisible) {
                currentPickerYear = Math.floor(selectedMonth / 100);
                populateMonthPicker();
            }
        });
        
        // Year navigation
        if (prevBtn) {
            prevBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                currentPickerYear--;
                populateMonthPicker();
            });
        }
        
        if (nextBtn) {
            nextBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                currentPickerYear++;
                populateMonthPicker();
            });
        }
        
        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && e.target !== btn) {
                dropdown.style.display = 'none';
            }
        });
    }
});



document.addEventListener('DOMContentLoaded', init);