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
let altPackageView = "cards"; // "cards" or "table"
let comparisonView = "list"; // "list" or "table"
let selectedComparisonShortageId = null;
let shortageAlternativesModal = null;
let historyChartRenderSeq = 0;
let historyData = null;
let historyGroupMap = new Map();
let historySubStrengthMap = new Map();
let currentViewModel = null;

// Constants
const SEARCH_RESULTS_LIMIT = 20;
const PACKAGE_SIZE_SAVINGS_THRESHOLD = 0.05; // 5%
const PRICE_SAVINGS_MIN = 1; // Minimum kr savings to show alerts

// DOM Element Cache - populated in init()
const DOM = {
    searchInput: null,
    customSelect: null,
    packageList: null,
    resultsDiv: null,
    chartCont: null,
    monthDropdown: null,
    headerPeriod: null,
    clearSearch: null,
    monthPickerBtn: null,
    monthPickerDropdown: null,
    darkModeToggle: null,
    priceCardArea: null,
    tableArea: null,
    monthWarningBanner: null,
};

function cacheDOM() {
    DOM.searchInput = document.getElementById('sub-input');
    DOM.customSelect = document.getElementById('custom-select');
    DOM.packageList = document.getElementById('package-list');
    DOM.resultsDiv = document.getElementById('results');
    DOM.chartCont = document.getElementById('chart-container');
    DOM.monthDropdown = document.getElementById('month-select-main');
    DOM.headerPeriod = document.getElementById('header-period');
    DOM.clearSearch = document.getElementById('clear-search');
    DOM.monthPickerBtn = document.getElementById('month-picker-btn');
    DOM.monthPickerDropdown = document.getElementById('month-picker-dropdown');
    DOM.darkModeToggle = document.getElementById('dark-mode-toggle');
    DOM.priceCardArea = document.getElementById('price-card-area');
    DOM.tableArea = document.getElementById('table-area');
    DOM.monthWarningBanner = document.getElementById('month-warning-banner');
    
    // Attach event handlers after DOM is cached
    attachEventHandlers();
}

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

            // Re-render chart so axis/grid colors follow the active theme.
            if (currentSearch) {
                requestAnimationFrame(() => {
                    renderHistoryChart();
                });
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

/**
 * Determines the status label (PV, R1, R2) for a medicine item.
 * @param {Object} item - Medicine item from data file
 * @param {string} [item.Status] - Explicit status field
 * @param {number} [item.Rang] - Numeric ranking (1=PV, 2=R1, 3=R2)
 * @returns {string} Status label ("PV", "R1", "R2", or empty string)
 */
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

function normalizeHistoryKey(value) {
    return String(value ?? '').trim().toLowerCase();
}

function makeHistoryGroupKey(id, sizeId) {
    return `${String(id ?? '')}|${String(sizeId ?? '')}`;
}

function makeHistorySubStrengthKey(sub, strength) {
    return `${normalizeHistoryKey(sub)}|${normalizeHistoryKey(strength)}`;
}

function getStatusPriority(item) {
    const status = getItemStatus(item).trim().toUpperCase();
    if (status === "PV") return 1;
    if (status.startsWith("R")) {
        const reserveRank = parseInt(status.substring(1), 10);
        return Number.isFinite(reserveRank) ? reserveRank + 1 : 100;
    }
    return 100;
}

function buildHistoryIndexes() {
    historyGroupMap = new Map();
    historySubStrengthMap = new Map();

    const groups = Array.isArray(historyData?.groups) ? historyData.groups : [];
    groups.forEach(group => {
        const groupKey = makeHistoryGroupKey(group.id, group.size_id);
        historyGroupMap.set(groupKey, group);

        const subKey = makeHistorySubStrengthKey(group.sub, group.str);
        if (!historySubStrengthMap.has(subKey)) {
            historySubStrengthMap.set(subKey, []);
        }
        historySubStrengthMap.get(subKey).push(group);

        group._monthCache = new Map();
    });

    for (const groupsForSub of historySubStrengthMap.values()) {
        groupsForSub.sort((a, b) => {
            const sizeA = toNumber(a.size) ?? 0;
            const sizeB = toNumber(b.size) ?? 0;
            if (sizeA !== sizeB) return sizeA - sizeB;
            return String(a.size_id).localeCompare(String(b.size_id), 'sv');
        });
    }
}

function getHistoryGroup(searchItem) {
    if (!searchItem) return null;
    return historyGroupMap.get(makeHistoryGroupKey(searchItem.id, searchItem.size_id)) || null;
}

function getHistorySubGroups(group) {
    if (!group) return [];
    return historySubStrengthMap.get(makeHistorySubStrengthKey(group.sub, group.str)) || [];
}

function parseIsoDate(value) {
    const text = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const date = new Date(`${text}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function addUtcMonths(date, months) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

function getMonthDateRange(monthCode) {
    const code = String(monthCode || '');
    if (code.length !== 4) return null;

    const year = 2000 + parseInt(code.slice(0, 2), 10);
    const month = parseInt(code.slice(2, 4), 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;

    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0));
    return { monthStart, monthEnd };
}

function isShortageActiveForMonth(shortage, monthCode) {
    const range = getMonthDateRange(monthCode);
    if (!range || !shortage) return false;

    const startDate = parseIsoDate(shortage.start_date);
    if (!startDate) return false;

    const endDate = parseIsoDate(shortage.end_date);
    const effectiveEnd = endDate || new Date(Date.UTC(9999, 11, 31));

    return startDate <= range.monthEnd && effectiveEnd >= range.monthStart;
}

function isShortageUpcomingWithinMonths(shortage, monthCode, monthsAhead = 3) {
    const range = getMonthDateRange(monthCode);
    if (!range || !shortage) return false;

    const startDate = parseIsoDate(shortage.start_date);
    if (!startDate) return false;

    const windowEnd = addUtcMonths(range.monthEnd, monthsAhead);
    return startDate > range.monthEnd && startDate <= windowEnd;
}

function getActiveShortageForMonth(brand, monthCode) {
    const shortages = Array.isArray(brand?.shortages) ? brand.shortages : [];

    const active = shortages.find(shortage => isShortageActiveForMonth(shortage, monthCode));
    if (active) return active;

    const upcoming = shortages
        .filter(shortage => isShortageUpcomingWithinMonths(shortage, monthCode, 3))
        .sort((a, b) => {
            const aDate = parseIsoDate(a.start_date)?.getTime() ?? Number.POSITIVE_INFINITY;
            const bDate = parseIsoDate(b.start_date)?.getTime() ?? Number.POSITIVE_INFINITY;
            return aDate - bDate;
        });

    return upcoming[0] || null;
}

function getShortageAlternativesText(shortage) {
    return String(
        shortage?.alternatives_info
        || shortage?.alternatives
        || shortage?.possible_alternatives
        || ''
    ).trim();
}

function ensureShortageAlternativesModal() {
    if (shortageAlternativesModal) return shortageAlternativesModal;

    const overlay = document.createElement('div');
    overlay.className = 'shortage-alt-modal-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
        <div class="shortage-alt-modal" role="dialog" aria-modal="true" aria-labelledby="shortage-alt-modal-title">
            <div class="shortage-alt-modal-header">
                <h3 id="shortage-alt-modal-title">Läkemedelsverkets information om möjliga alternativ</h3>
                <button type="button" class="shortage-alt-modal-close" aria-label="Stäng">&times;</button>
            </div>
            <div class="shortage-alt-modal-content"></div>
        </div>
    `;

    const closeButton = overlay.querySelector('.shortage-alt-modal-close');
    const modalPanel = overlay.querySelector('.shortage-alt-modal');
    const close = () => {
        overlay.setAttribute('hidden', '');
        overlay.classList.remove('is-open');
    };

    closeButton?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
    });
    modalPanel?.addEventListener('click', (event) => {
        event.stopPropagation();
    });
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close();
    });

    document.addEventListener('keydown', (event) => {
        if (!overlay.hasAttribute('hidden') && event.key === 'Escape') {
            close();
        }
    });

    document.body.appendChild(overlay);
    shortageAlternativesModal = overlay;
    return overlay;
}

function openShortageAlternativesModal(shortage) {
    const modal = ensureShortageAlternativesModal();
    const content = modal.querySelector('.shortage-alt-modal-content');
    if (!content) return;

    const alternativesText = getShortageAlternativesText(shortage);
    content.textContent = alternativesText || 'Ingen information om möjliga alternativ har publicerats för denna restnotering.';
    modal.removeAttribute('hidden');
    modal.classList.add('is-open');
}

function getGroupMonthRows(group, monthCode) {
    if (!group) return [];
    const monthKey = String(monthCode);

    if (group._monthCache && group._monthCache.has(monthKey)) {
        return group._monthCache.get(monthKey);
    }

    const rows = [];
    for (const brand of group.brands || []) {
        const monthRecord = brand.history?.[monthKey];
        if (!monthRecord) continue;
        const activeShortage = getActiveShortageForMonth(brand, monthCode);

        const row = {
            Produktnamn: brand.name,
            Varunummer: toNumber(brand.vnr),
            Vnr: toNumber(brand.vnr),
            Styrka: group.str,
            Substans: group.sub,
            Beredningsform: group.form,
            Läkemedelsform: group.form,
            Storlek: group.size,
            Företag: brand.company,
            Ursprung: brand.origin,
            Status: monthRecord.status,
            Rang: monthRecord.rank ?? null,
            "Försäljningspris": monthRecord.price,
            "Utbytesgrupps ID": toNumber(group.id),
            "Förpackningsstorleksgrupp": group.size_id,
            shortage: activeShortage,
        };

        if (brand.packaging) {
            row.Förpackning = brand.packaging;
        }

        rows.push(row);
    }

    rows.sort((a, b) => {
        const priorityDiff = getStatusPriority(a) - getStatusPriority(b);
        if (priorityDiff !== 0) return priorityDiff;
        const priceDiff = toNumber(a["Försäljningspris"]) - toNumber(b["Försäljningspris"]);
        if (priceDiff !== 0) return priceDiff;
        return String(a.Produktnamn).localeCompare(String(b.Produktnamn), 'sv');
    });

    if (group._monthCache) {
        group._monthCache.set(monthKey, rows);
    }

    return rows;
}

function getMonthPvRow(group, monthCode) {
    const rows = getGroupMonthRows(group, monthCode);
    return rows.find(item => getItemStatus(item).trim().toUpperCase() === "PV") || rows[0] || null;
}

function getMonthCheapestRow(group, monthCode) {
    const rows = getGroupMonthRows(group, monthCode);
    if (rows.length === 0) return null;
    return rows.reduce((lowest, item) => {
        if (!lowest) return item;
        return toNumber(item["Försäljningspris"]) < toNumber(lowest["Försäljningspris"]) ? item : lowest;
    }, null);
}

function calculatePriceStatsForGroup(group, months = availableMonths.slice(0, 12)) {
    if (!group) return null;

    const prices = [];
    for (const month of months) {
        const match = getMonthPvRow(group, month);
        const price = toNumber(match?.["Försäljningspris"]);
        if (Number.isFinite(price)) {
            prices.push(price);
        }
    }

    if (prices.length === 0) return null;

    return {
        avgPrice: prices.reduce((a, b) => a + b, 0) / prices.length,
        minPrice: Math.min(...prices),
        maxPrice: Math.max(...prices),
        count: prices.length
    };
}

function getMonthPvPrice(group, monthCode) {
    if (!group || !monthCode) return null;
    const monthRow = getMonthPvRow(group, monthCode);
    const price = toNumber(monthRow?.["Försäljningspris"]);
    return Number.isFinite(price) ? price : null;
}

function buildProductViewModel(searchItem, monthCode = selectedMonth) {
    const group = getHistoryGroup(searchItem);
    if (!group) return null;

    const monthRows = getGroupMonthRows(group, monthCode);
    if (monthRows.length === 0) {
        return {
            searchItem,
            group,
            monthCode,
            monthRows: []
        };
    }

    const pvProduct = monthRows.find(i => getItemStatus(i).trim().toUpperCase() === "PV") || monthRows[0];
    const pvPrice = toNumber(pvProduct["Försäljningspris"]);
    const absoluteMinPrice = Math.min(...monthRows.map(i => toNumber(i["Försäljningspris"])).filter(Number.isFinite));
    const savings = Number.isFinite(pvPrice) && Number.isFinite(absoluteMinPrice) ? pvPrice - absoluteMinPrice : 0;
    const cheaperProduct = savings >= PRICE_SAVINGS_MIN
        ? monthRows.find(i => toNumber(i["Försäljningspris"]) === absoluteMinPrice) || null
        : null;

    const stats = calculatePriceStatsForGroup(group);
    const currentIndex = availableMonths.indexOf(parseInt(monthCode, 10));
    const prevMonthCode = currentIndex >= 0 ? availableMonths[currentIndex + 1] : null;
    const nextMonthCode = currentIndex >= 0 ? availableMonths[currentIndex - 1] : null;

    return {
        searchItem,
        group,
        monthCode,
        monthRows,
        pvProduct,
        pvPrice,
        absoluteMinPrice,
        savings,
        cheaperProduct,
        stats,
        prevMonthCode,
        nextMonthCode,
        prevPrice: getMonthPvPrice(group, prevMonthCode),
        nextPrice: getMonthPvPrice(group, nextMonthCode),
        subGroups: getHistorySubGroups(group)
    };
}

/**
 * Initializes the application by loading data, caching DOM elements,
 * and setting up the initial UI state.
 * @async
 * @throws {Error} If data files cannot be loaded
 */
async function init() {
    try {
        // Cache DOM elements for performance
        cacheDOM();
        
        // Om din fil heter substances.json men innehåller den nya index-listan:
        const cacheBust = `v=${Date.now()}`;
        const res = await fetch(`data/search-index.json?${cacheBust}`);
        searchIndex = await res.json();

        // Load aggregated product history for instant month switching
        const historyRes = await fetch(`data/product-history.json?${cacheBust}`);
        historyData = await historyRes.json();
        buildHistoryIndexes();

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
            // Find the closest earlier month, or fall back to the first available month
            selectedMonth = availableMonths.find(m => m <= systemMonthCode) || availableMonths[0];
        }
        
        // Uppdatera UI
        if (DOM.monthDropdown) {
            DOM.monthDropdown.replaceChildren();
            availableMonths.forEach(m => {
                const option = document.createElement('option');
                const prelimTag = isPrelimMonth(m) ? ' (Preliminär)' : '';
                option.value = m;
                option.textContent = `${formatMedicineDate(m)}${prelimTag}`;
                if (m == selectedMonth) {
                    option.selected = true;
                }
                DOM.monthDropdown.appendChild(option);
            });
        }
        
        // Update header with current month
        if (DOM.headerPeriod) {
            const prelimTag = isPrelimMonth(selectedMonth) ? " • Preliminär" : "";
            DOM.headerPeriod.textContent = `TLV Periodens Varor • ${formatMedicineDate(selectedMonth)}${prelimTag}`;
        }
        
        // Load medicine from URL if VNR is present
        loadMedicineFromUrl();
    } catch (e) {
        console.error("Kunde inte ladda startdata", e);
    }
}

// Keyboard navigation for search dropdown - declare variables before attachEventHandlers
let selectedDropdownIndex = -1;
let lastDropdownMatches = [];
let originalSearchInput = '';

function attachEventHandlers() {
    if (!DOM.searchInput) return; // Exit if DOM not cached
    
    // Search input - oninput event
    DOM.searchInput.addEventListener('input', function () {
        const searchTerm = this.value.toLowerCase().trim();
        const listContainer = DOM.packageList;
        const dropdown = DOM.customSelect;
        const clearBtn = DOM.clearSearch;

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
            // Also check VNR (Varunummer)
            const vnrMatch = item.vnr && (
                Array.isArray(item.vnr) 
                    ? item.vnr.some(v => String(v).includes(searchTerm))
                    : String(item.vnr).includes(searchTerm)
            );
            
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
            
            return subMatch || nameMatch || subMatchNoMg || nameMatchNoMg || multiPartMatch || fullMatch || fullMatchNoMg || vnrMatch;
        });

        // Store matches for keyboard navigation
        lastDropdownMatches = matches.slice(0, SEARCH_RESULTS_LIMIT);

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
        lastDropdownMatches = matches.slice(0, SEARCH_RESULTS_LIMIT);

        // 3. Rendera resultaten
        if (matches.length > 0) {
            // Vi begränsar till SEARCH_RESULTS_LIMIT träffar för prestanda
            // Use DocumentFragment to batch DOM appends for better performance
            const fragment = document.createDocumentFragment();
            
            matches.slice(0, SEARCH_RESULTS_LIMIT).forEach(item => {
                const itemTemplate = cloneTemplate('template-dropdown-item');
                if (!itemTemplate) return;
                const div = itemTemplate.querySelector('.dropdown-item');
                const subEl = div.querySelector('[data-field="sub"]');
                const strEl = div.querySelector('[data-field="str"]');
                const metaEl = div.querySelector('[data-field="meta"]');

                if (subEl) subEl.textContent = item.sub;
                if (strEl) strEl.textContent = item.str;
                if (metaEl) metaEl.textContent = `${item.form} | ${formatSizeDisplay(item.size)}`;

                div.addEventListener('click', function () {
                    DOM.searchInput.value = item.sub + ' ' + item.str;
                    dropdown.style.display = "none";
                    
                    // Använd ID:n från indexet för en exakt och snabb sökning i data-filen
                    // Lägg till VNR för URL-delning
                    if (item.vnr && item.vnr.length > 0) {
                        item.vnr = item.vnr[0]; // Use first VNR for initial load
                    }
                    fetchLatestPV(item); 
                });
                fragment.appendChild(itemTemplate);
            });
            listContainer.appendChild(fragment);
            dropdown.style.display = "block";
        } else {
            // Show no results message in dropdown
            const noResultsTemplate = cloneTemplate('template-dropdown-no-results');
            if (noResultsTemplate) {
                listContainer.appendChild(noResultsTemplate);
            }
            dropdown.style.display = "block";
        }
    });

    // Search input - focus event
    DOM.searchInput.addEventListener('focus', function () {
        const searchTerm = this.value.toLowerCase().trim();
        if (searchTerm.length >= 2) {
            this.dispatchEvent(new Event('input'));
        }
    });

    // Clear search button - click event
    DOM.clearSearch.addEventListener('click', function () {
        const input = DOM.searchInput;
        const dropdown = DOM.customSelect;
        input.value = '';
        this.style.display = 'none';
        dropdown.style.display = 'none';
        input.focus();
    });

    // Popular chips - click event (already using addEventListener, no change needed)
    document.querySelectorAll('.popular-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            const input = DOM.searchInput;
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

    // Search input - keydown event
    DOM.searchInput.addEventListener('keydown', function (e) {
        const dropdown = DOM.customSelect;
        const listContainer = DOM.packageList;
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
                DOM.searchInput.value = originalSearchInput;
                if (!originalSearchInput) {
                    currentSearch = null;
                    document.body.classList.remove('has-selection');
                }
                break;
        }
    });
}

function updateInputFromSelection(index) {
    const input = DOM.searchInput;
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


/**
 * Fetches and displays medicine details for the selected product.
 * Updates URL with VNR for shareability and loads price data.
 * @async
 * @param {Object} searchItem - Selected medicine from search index
 * @param {string} searchItem.id - Exchange group ID
 * @param {string} searchItem.size_id - Package size group ID
 * @param {string} searchItem.sub - Substance name
 * @param {string} searchItem.str - Strength
 * @param {string} searchItem.form - Medicine form
 * @param {string} searchItem.vnr - Varunummer (product number)
 * @param {boolean} [skipPushState=false] - If true, don't update browser history
 */
async function fetchLatestPV(searchItem, skipPushState = false) {
    currentSearch = searchItem;
    currentViewModel = null;
    
    // Update URL with VNR for shareability and history support (unless we're responding to popstate)
    const vnr = searchItem.vnr;
    if (vnr && !skipPushState) {
        const url = new URL(window.location);
        url.searchParams.set('vnr', vnr);
        window.history.pushState({ searchItem }, '', url.toString());
    }
    
    // Hide hero content and show search bar for medicine selection
    document.body.classList.add('has-selection');
    
    const resultsDiv = DOM.resultsDiv;
    replaceContent(resultsDiv, cloneTemplate('template-loading'));

    try {
        const viewModel = buildProductViewModel(searchItem, selectedMonth);
        if (!viewModel || !viewModel.group) {
            replaceContent(resultsDiv, cloneTemplate('template-no-results'));
            return;
        }

        if (!Array.isArray(viewModel.monthRows) || viewModel.monthRows.length === 0) {
            replaceContent(resultsDiv, cloneTemplate('template-no-results'));
            return;
        }

        currentViewModel = viewModel;

        lastMatches = viewModel.monthRows;
        lastPVPrice = viewModel.pvPrice;

        replaceContent(resultsDiv, cloneTemplate('template-results-container'));

        const chartCont = DOM.chartCont;
        if (chartCont) {
            chartCont.style.display = "block";
            chartCont.className = "bleed-card";
        }

        // Show month picker button when viewing medicine
        showMonthPicker();

        // Skicka med spar-data till renderaren
        await renderPriceCard(viewModel);
        
        // Create and inject month warning banner after price card is rendered
        createMonthBanner(resultsDiv);
        
        renderTableOnly(); 
        await renderHistoryChart(viewModel);
        renderAlternativePackageSizes(viewModel);

        // Visa info-boxen endast om PV inte är billigast (efter renderTableOnly som skapar den)
        if (!viewModel.cheaperProduct) {
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

/**
 * Calculates price statistics across available months for trend analysis.
 * @async
 * @param {Object} searchItem - Medicine search item
 * @returns {Promise<Object|null>} Statistics object with avgPrice, minPrice, maxPrice, count
 */
async function getPriceStatistics(searchItem) {
    const group = getHistoryGroup(searchItem);
    return calculatePriceStatsForGroup(group);
}

/**
 * Renders the price card showing current price, trends, and recommendations.
 * @async
 * @param {Object} viewModel - Product view model for current month
 */
async function renderPriceCard(viewModel) {
    const { pvProduct, searchItem, stats, cheaperProduct, savings, monthRows: currentMonthRows } = viewModel;
    const sub = searchItem.sub;
    const str = searchItem.str;
    const form = searchItem.form;
    const area = document.getElementById('price-card-area');
    if (!pvProduct || !area) return;

    const formatPrice = (p) => new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK" }).format(p);

    const prevMonthCode = viewModel.prevMonthCode;
    const nextMonthCode = viewModel.nextMonthCode;
    const prevPrice = viewModel.prevPrice;
    const nextPrice = viewModel.nextPrice;
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

        const canJumpToMonth = monthCode && monthCode !== selectedMonth;
        if (canJumpToMonth) {
            const monthButton = document.createElement('button');
            monthButton.type = 'button';
            monthButton.className = 'stat-block-label-button';
            monthButton.textContent = label;
            monthButton.setAttribute('aria-label', `Visa ${label.toLowerCase()}`);
            monthButton.addEventListener('click', () => updateMonth(monthCode));
            labelEl.appendChild(monthButton);
        } else {
            labelEl.textContent = label;
        }
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
        headerBar.classList.remove('is-alert-red');
    } else {
        headerBar.style.display = 'flex';
        headerBar.style.background = '';
        headerBar.style.border = '';
        headerBar.classList.toggle('is-alert-red', rec.icon === 'shopping_cart_checkout');

        const headerIcon = area.querySelector('.price-card-icon');
        headerIcon.textContent = rec.icon;
        headerIcon.style.color = '';

        const headerLabel = area.querySelector('.price-card-header-label');
        headerLabel.textContent = `${rec.label}!`;
        headerLabel.style.color = '';

        const headerSubtext = area.querySelector('.price-card-header-subtext');
        headerSubtext.textContent = rec.subtext;
        headerSubtext.style.color = '';
    }

    area.querySelector('.price-card-title').textContent = pvProduct.Produktnamn;
    area.querySelector('.price-card-subtitle').textContent = `${sub} · ${str} · ${form}`;
    area.querySelector('.price-card-current-value').textContent = formatPrice(pvProduct["Försäljningspris"]);
    
    // Add price per pill under current price
    const currentWrapper = area.querySelector('.price-card-current-wrapper');
    let pricePerPillDiv = currentWrapper.querySelector('.price-per-pill');
    if (!pricePerPillDiv) {
        pricePerPillDiv = document.createElement('div');
        pricePerPillDiv.className = 'price-per-pill';
        pricePerPillDiv.style.fontSize = '12px';
        pricePerPillDiv.style.marginTop = '4px';
        pricePerPillDiv.style.color = '#64748b';
        currentWrapper.appendChild(pricePerPillDiv);
    }
    const packageSize = toNumber(pvProduct.Storlek);
    const price = toNumber(pvProduct["Försäljningspris"]);
    if (packageSize && price) {
        const pricePerUnit = price / packageSize;
        // Determine correct unit based on medicine form
        const f = form.toLowerCase();
        let unit = "enhet";
        if (f.includes("tablett")) unit = "tablett";
        else if (f.includes("kapsel")) unit = "kapsel";
        else if (f === "gel" || f.includes("kräm") || f.includes("salva")) unit = "g";
        else if (f.includes("droppar") || f.includes("lösning")) unit = "ml";
        pricePerPillDiv.textContent = `${pricePerUnit.toFixed(2)} kr/${unit}`;
    }

    const savingsSlot = area.querySelector('.price-card-savings-slot');
    
    // Check for better package size deals - search in the current month's rows for same substance/strength PV variants
    let betterSizeDeal = null;
    let cheaperProductDeal = null;
    
    if (currentMonthRows) {
        betterSizeDeal = findBetterPackageSize(pvProduct, currentMonthRows);
    }
    
    if (cheaperProduct && savings >= PRICE_SAVINGS_MIN) {
        cheaperProductDeal = {
            type: 'brand',
            savings: savings,
            produktnamn: cheaperProduct.Produktnamn
        };
    }
    
    // Determine which deal to show - the one with biggest savings
    let dealToShow = null;
    if (betterSizeDeal && cheaperProductDeal) {
        // Show the one with biggest savings percentage
        const sizeSavingsKr = pvProduct["Försäljningspris"] - (betterSizeDeal.pricePerUnit * toNumber(pvProduct.Storlek));
        dealToShow = sizeSavingsKr > cheaperProductDeal.savings ? 'size' : 'brand';
    } else if (betterSizeDeal) {
        dealToShow = 'size';
    } else if (cheaperProductDeal) {
        dealToShow = 'brand';
    }
    
    // Show the selected deal
    if (dealToShow === 'brand' && cheaperProductDeal) {
        const savingsTpl = cloneTemplate('template-savings-alert');
        if (savingsTpl) {
            const savingsNode = savingsTpl.querySelector('.savings-alert-box');
            const title = savingsNode.querySelector('.savings-alert-title');
            const text = savingsNode.querySelector('.savings-alert-text');
            title.textContent = `Spara ${cheaperProductDeal.savings.toFixed(2).replace('.', ',')} kr!`;
            text.textContent = '';
            const strong = document.createElement('strong');
            strong.textContent = cheaperProductDeal.produktnamn;
            text.appendChild(strong);
            text.append(' är billigare än Periodens Vara.');
            savingsSlot.appendChild(savingsNode);
        }
    } else if (dealToShow === 'size' && betterSizeDeal) {
        const dealTpl = cloneTemplate('template-savings-alert');
        if (dealTpl) {
            const dealNode = dealTpl.querySelector('.savings-alert-box');
            const title = dealNode.querySelector('.savings-alert-title');
            const text = dealNode.querySelector('.savings-alert-text');
            const unit = formatUnitSingular(pvProduct.Beredningsform);
            title.textContent = `${betterSizeDeal.size} är ${betterSizeDeal.savings.toFixed(1).replace('.', ',')}% billigare per ${unit}`;
            text.textContent = 'Fråga din läkare om du kan få ';
            
            // Create clickable strong element that loads the alternative product
            const button = document.createElement('button');
            button.textContent = betterSizeDeal.size;
            button.style.background = 'none';
            button.style.border = 'none';
            button.style.color = 'inherit';
            button.style.cursor = 'pointer';
            button.style.padding = '0';
            button.style.font = 'inherit';
            button.style.fontWeight = '900';
            button.style.textDecoration = 'none';
            button.addEventListener('click', function() {
                // Find the product with this size in the current month rows
                const alternativeProduct = currentMonthRows.find(item => 
                    item.Substans === pvProduct.Substans &&
                    item.Styrka === pvProduct.Styrka &&
                    item.Storlek === betterSizeDeal.targetSize &&
                    getItemStatus(item) === "PV"
                );
                if (alternativeProduct) {
                    fetchLatestPV({
                        id: alternativeProduct["Utbytesgrupps ID"],
                        size_id: alternativeProduct["Förpackningsstorleksgrupp"],
                        sub: alternativeProduct.Substans,
                        str: alternativeProduct.Styrka,
                        form: alternativeProduct.Beredningsform,
                        vnr: alternativeProduct.Varunummer || alternativeProduct.Vnr
                    });
                }
            });
            text.appendChild(button);
            text.append(' istället');
            savingsSlot.appendChild(dealNode);
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
        return pvProduct.Förpackning || '—';
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

/**
 * Renders the comparison table showing all available products with prices.
 * Updates the table based on isExpanded state.
 */
function renderTableOnly() {
    const area = document.getElementById('table-area');
    if (!area) return;

    const template = cloneTemplate('template-table-container');
    replaceContent(area, template);
    const strong = area.querySelector('.comparison-subtitle-strong');
    if (strong) {
        strong.textContent = `${currentSearch.sub} ${currentSearch.str}`;
    }

    const comparisonToggleBtn = area.querySelector('#comparison-view-toggle');
    if (comparisonToggleBtn) {
        updateComparisonViewToggle(comparisonToggleBtn);
        comparisonToggleBtn.addEventListener('click', toggleComparisonView);
    }

    const shortageCount = Array.isArray(lastMatches)
        ? lastMatches.filter(item => item?.shortage).length
        : 0;
    const hasShortages = shortageCount > 0;
    if (hasShortages) {
        const comparisonCard = area.querySelector('.comparison-container');
        if (comparisonCard) {
            const bannerCard = document.createElement('div');
            bannerCard.className = 'shortage-impact-card price-card-header-bar is-alert-red';
            bannerCard.innerHTML = `
                <div class="price-card-icon-wrapper">
                    <span class="material-symbols-outlined price-card-icon">warning</span>
                </div>
                <div class="price-card-header-text">
                    <p class="price-card-header-label">Restnoterade tillverkare</p>
                    <p class="price-card-header-subtext"><strong>${shortageCount} st</strong> tillverkare har rapporterat en restnotering. Det kan påverka tillgången och leda till ett högre pris.</p>
                </div>
            `;
            area.insertBefore(bannerCard, comparisonCard);
        }
    }

    updateTableRows(lastMatches);
}

function getComparisonItemUnit(item) {
    const form = (item?.Läkemedelsform || "").toLowerCase();
    if (form.includes("gel") || form.includes("salva") || form.includes("kräm")) return "g";
    if (form.includes("droppar") || form.includes("lösning")) return "ml";
    return "st";
}

function updateComparisonViewToggle(button) {
    if (!button) return;
    const showingTable = comparisonView === 'table';
    const icon = button.querySelector('.material-symbols-outlined');
    const label = showingTable ? 'Visa listvy' : 'Visa tabellvy';

    button.setAttribute('aria-label', label);
    button.title = label;
    if (icon) {
        icon.textContent = showingTable ? 'table_rows' : 'list';
    }
}

function renderComparisonTableRows(data, minPriceInData) {
    const tableContainer = document.getElementById('comparison-table');
    if (!tableContainer) return;

    const table = document.createElement('table');
    table.className = 'comparison-alt-table';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Namn</th>
                <th>Tillverkare</th>
                <th>Antal</th>
                <th>typ</th>
                <th>Typ</th>
                <th>Pris</th>
            </tr>
        </thead>
    `;

    const tbody = document.createElement('tbody');

    data.forEach((item, index) => {
        const rawStatus = getItemStatus(item).trim().toUpperCase();
        const status = (rawStatus === 'PV' || rawStatus === 'R1' || rawStatus === 'R2') ? rawStatus : '';
        const size = item?.Storlek ?? '—';
        const unit = getComparisonItemUnit(item);
        const packagingType = item?.["Förpackning"] || '—';
        const type = (item?.Ursprung || 'Generics').toString();
        const manufacturer = item?.Företag || '—';
        const name = item?.Produktnamn || '—';
        const priceVal = Number(item?.["Försäljningspris"]);
        const price = Number.isFinite(priceVal)
            ? `${priceVal.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`
            : '—';
        const priceDiff = Number.isFinite(priceVal) && Number.isFinite(lastPVPrice)
            ? priceVal - lastPVPrice
            : null;
        const priceDiffText = priceDiff === null
            ? '—'
            : priceDiff === 0
                ? 'PV'
                : priceDiff > 0
                    ? `+${priceDiff.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`
                    : `${priceDiff.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
        const priceDiffClass = priceDiff === null
            ? 'diff-neutral'
            : priceDiff === 0
                ? 'diff-pv'
                : priceDiff > 0
                    ? 'diff-up'
                    : 'diff-down';
        const rowStatusClass = status === 'PV'
            ? 'status-pv'
            : (status === 'R1' || status === 'R2')
                ? 'status-r'
                : 'status-other';
        const statusCellHtml = status
            ? `<span class="comparison-status-pill ${rowStatusClass}">${status}</span>`
            : '';
        const rowClass = status === 'PV'
            ? 'pv-row'
            : (status === 'R1' || status === 'R2')
                ? 'reserve-row'
                : 'comparison-other-row';
        const isCheapest = Number.isFinite(priceVal) && Number.isFinite(minPriceInData) && priceVal === minPriceInData;
        const cheapestCellHtml = isCheapest
            ? `<span class="comparison-status-pill status-cheapest"><span class="material-symbols-outlined">star</span></span>`
            : '';
        const effectiveRowClass = isCheapest ? `${rowClass} cheapest-row` : rowClass;
        const rowId = String(
            item.Vnr ?? `${(item.Produktnamn || '')}-${(item.Företag || '')}-${(item.Storlek || '')}-${index}`
        );
        const hasShortage = Boolean(item?.shortage);
        const isShortageOpen = hasShortage && selectedComparisonShortageId === rowId;
        const shortageType = String(item?.shortage?.shortage_type || '').trim() || 'Restnoterad';

        const row = document.createElement('tr');
        row.className = effectiveRowClass;
        if (isShortageOpen) {
            row.classList.add('comparison-row-expanded');
        }
        row.innerHTML = `
            <td>
                <div class="comparison-name-cell">
                    ${statusCellHtml}
                    ${cheapestCellHtml}
                    <span>${name}</span>
                </div>
            </td>
            <td>
                <div class="comparison-manufacturer-cell">
                    <span>${manufacturer}</span>
                    ${hasShortage ? `<button type="button" class="comparison-shortage-btn${isShortageOpen ? ' is-open' : ''}"><span class="material-symbols-outlined">warning</span>${shortageType}</button>` : ''}
                </div>
            </td>
            <td>${size} ${unit}</td>
            <td>${packagingType}</td>
            <td>${type}</td>
            <td class="comparison-price-cell">
                <div class="price-wrapper comparison-price-wrapper">
                    <span class="comparison-price-main">${price}</span>
                    <span class="diff-subtext ${priceDiffClass}">${priceDiffText}</span>
                </div>
            </td>
        `;

        if (hasShortage) {
            const shortageBtn = row.querySelector('.comparison-shortage-btn');
            if (shortageBtn) {
                shortageBtn.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleComparisonShortageDetails(rowId);
                });
            }
        }

        tbody.appendChild(row);

        if (isShortageOpen) {
            const detailsRow = document.createElement('tr');
            detailsRow.className = `comparison-shortage-expand-row ${effectiveRowClass}`;

            const detailCell = document.createElement('td');
            detailCell.colSpan = 6;

            const shortage = item.shortage || {};
            const title = String(shortage.status || '').trim() || String(shortage.shortage_type || '').trim() || 'Restnotering';
            const startText = shortage.start_text || shortage.start_date || 'Okänt';
            const endText = shortage.end_text || shortage.end_date || 'Tills vidare';
            const reasonText = shortage.reason || 'Ingen orsak angiven.';
            detailCell.innerHTML = `
                <div class="row-shortage-note comparison-shortage-note">
                    <p class="row-shortage-title">${title}</p>
                    <p class="row-shortage-dates">${startText} - ${endText}</p>
                    <p class="row-shortage-reason">${reasonText}</p>
                </div>
            `;

            const note = detailCell.querySelector('.comparison-shortage-note');
            if (note) {
                const actions = document.createElement('div');
                actions.className = 'row-shortage-actions';

                const alternativesButton = document.createElement('button');
                alternativesButton.type = 'button';
                alternativesButton.className = 'row-shortage-alt-btn';
                alternativesButton.textContent = 'Möjliga alternativ (Läkemedelsverket)';
                alternativesButton.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openShortageAlternativesModal(shortage);
                });

                actions.appendChild(alternativesButton);
                note.appendChild(actions);
            }

            detailsRow.appendChild(detailCell);
            tbody.appendChild(detailsRow);
        }
    });

    table.appendChild(tbody);
    tableContainer.replaceChildren(table);
}

/**
 * Updates table rows with medicine data, including status badges and pricing.
 * Uses DocumentFragment for efficient DOM manipulation.
 * @param {Array<Object>} data - Array of medicine items to display
 */
function updateTableRows(data) {
    const container = document.getElementById('comparison-list');
    const tableContainer = document.getElementById('comparison-table');
    const footer = document.getElementById('pagination-footer');
    if (!container || !tableContainer) return;

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
    tableContainer.innerHTML = '';

    if (comparisonView === 'table') {
        container.hidden = true;
        tableContainer.hidden = false;
        renderComparisonTableRows(rowsToShow, minPriceInData);
        return;
    }

    container.hidden = false;
    tableContainer.hidden = true;
    
    // Use DocumentFragment to batch DOM appends for better performance
    const tableFragment = document.createDocumentFragment();
    
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

        let shortageBadgeHtml = '';
        if (item.shortage) {
            const shortageType = String(item.shortage.shortage_type || '').trim() || 'Försäljningsuppehåll';
            shortageBadgeHtml = `<span class="status-badge-mini badge-shortage badge-shortage-inline"><span class="material-symbols-outlined">warning</span>${shortageType}</span>`;
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

        if (shortageBadgeHtml) {
            const rowProduct = rowDiv.querySelector('.comparison-row-product');
            if (rowProduct) {
                rowProduct.insertAdjacentHTML('beforeend', shortageBadgeHtml);
            }
        }
        
        const priceDiffEl = rowDiv.querySelector('.price-diff');
        if (priceDiffEl && priceDiffStyle) {
            priceDiffEl.setAttribute('style', priceDiffStyle);
        }

        if (isOpen) {
            const forpackning = item["Förpackning"]
                || '—';

            const detailsFragment = cloneTemplate('template-row-details');
            const detailsDiv = detailsFragment.querySelector('.row-details-container');
            const detailItems = detailsDiv.querySelectorAll('.row-detail-item');
            
            replaceContent(detailItems[0], '.row-detail-value', `${size} ${unit}`);
            replaceContent(detailItems[1], '.row-detail-value', forpackning);
            replaceContent(detailItems[2], '.row-detail-value', item.Företag || '—');
            replaceContent(detailItems[3], '.row-detail-value', item.Ursprung || 'Generics');

            if (item.shortage) {
                const shortageBox = document.createElement('div');
                shortageBox.className = 'row-shortage-note';

                const title = document.createElement('p');
                title.className = 'row-shortage-title';
                title.textContent = String(item.shortage.status || '').trim() || String(item.shortage.shortage_type || '').trim() || 'Försäljningsuppehåll';

                const dates = document.createElement('p');
                dates.className = 'row-shortage-dates';
                const startText = item.shortage.start_text || item.shortage.start_date || 'Okänt';
                const endText = item.shortage.end_text || item.shortage.end_date || 'Tills vidare';
                dates.textContent = `${startText} - ${endText}`;

                const reason = document.createElement('p');
                reason.className = 'row-shortage-reason';
                reason.textContent = item.shortage.reason || 'Ingen orsak angiven.';

                shortageBox.append(title, dates, reason);

                const actions = document.createElement('div');
                actions.className = 'row-shortage-actions';

                const alternativesButton = document.createElement('button');
                alternativesButton.type = 'button';
                alternativesButton.className = 'row-shortage-alt-btn';
                alternativesButton.textContent = 'Möjliga alternativ (Läkemedelsverket)';
                alternativesButton.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openShortageAlternativesModal(item.shortage);
                });

                actions.appendChild(alternativesButton);
                shortageBox.appendChild(actions);

                detailsDiv.appendChild(shortageBox);
            }

            rowDiv.appendChild(detailsDiv);
        }

        tableFragment.appendChild(rowFragment);
    });
    
    container.appendChild(tableFragment);

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
    let existingBanner = document.getElementById('month-warning-banner');
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

function toggleComparisonShortageDetails(rowId) {
    selectedComparisonShortageId = (selectedComparisonShortageId === rowId) ? null : rowId;
    updateTableRows(lastMatches);
}

function toggleComparisonView() {
    comparisonView = comparisonView === 'table' ? 'list' : 'table';
    selectedRowId = null;
    selectedComparisonShortageId = null;

    const toggleBtn = document.getElementById('comparison-view-toggle');
    updateComparisonViewToggle(toggleBtn);
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
    const monthName = months[parseInt(monthIndex, 10) - 1];
    return monthName || "Okänt datum";
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

function formatUnitSingular(form) {
    const f = (form || '').toLowerCase();
    let unit = "enhet";
    if (f.includes("tablett")) unit = "tablett";
    else if (f.includes("kapsel")) unit = "kapsel";
    else if (f === "gel" || f.includes("kräm") || f.includes("salva")) unit = "gram";
    else if (f.includes("droppar") || f.includes("lösning")) unit = "ml";
    return unit;
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

/**
 * Renders price history chart showing trends across available months.
 * Supports both PV and cheapest price views with configurable date ranges.
 * @async
 * @param {Object} viewModel - Product view model
 */
async function renderHistoryChart(viewModel) {
    const renderSeq = ++historyChartRenderSeq;
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
    
    const existingChart = typeof Chart.getChart === 'function' ? Chart.getChart(canvas) : null;
    if (existingChart) {
        existingChart.destroy();
    } else if (window.myChart instanceof Chart) {
        window.myChart.destroy();
    }
    window.myChart = null;

    const resolvedViewModel = viewModel?.group
        ? viewModel
        : (currentViewModel?.group
            ? currentViewModel
            : (currentSearch ? buildProductViewModel(currentSearch, selectedMonth) : null));
    const group = resolvedViewModel?.group;
    if (!group) return;

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
    const stats = resolvedViewModel.stats || calculatePriceStatsForGroup(group);
    
    for (const month of chronologicalMonths) {
        const match = chartPriceType === "cheapest"
            ? getMonthCheapestRow(group, month)
            : getMonthPvRow(group, month);

        if (!match) continue;

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

    if (historyPoints.length === 0) {
        if (renderSeq !== historyChartRenderSeq) return;
        container.style.display = "none";
        return;
    }

    if (renderSeq !== historyChartRenderSeq) return;
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

    // A later render may have completed while this async render was fetching data.
    // Re-check and clear any chart on this canvas right before creating a new one.
    if (renderSeq !== historyChartRenderSeq) return;
    const latestChart = typeof Chart.getChart === 'function' ? Chart.getChart(canvas) : null;
    if (latestChart) {
        latestChart.destroy();
    } else if (window.myChart && typeof window.myChart.destroy === 'function') {
        window.myChart.destroy();
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
                        title: function(context) {
                            if (!context || context.length === 0) return '';
                            const point = historyPoints[context[0].dataIndex];
                            if (!point?.monthCode) return context[0].label;
                            const monthCode = String(point.monthCode);
                            if (monthCode.length !== 4) return formatMedicineDate(point.monthCode);
                            return `${formatMedicineDate(point.monthCode)} 20${monthCode.substring(0, 2)}`;
                        },
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
        stabilityText = `Priset har varit mycket stabilt med minimal variation (±${coefficientOfVariation.toFixed(1).replace('.', ',')}%).`;
        stabilityBg = "#f0fdf4";
    } else if (coefficientOfVariation < 8) {
        stabilityLabel = "Stabilt pris";
        stabilityColor = "#0891b2";
        stabilityIcon = "trending_flat";
        stabilityText = `Priset har varit relativt stabilt med låg variation (±${coefficientOfVariation.toFixed(1).replace('.', ',')}%).`;
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

function renderAlternativePackageSizes(viewModel) {
    const sectionContainer = document.getElementById('alt-package-sizes-container');
    if (!sectionContainer) return;

    const existingSection = document.getElementById('alt-package-sizes');
    if (existingSection) existingSection.remove();

    const currentProduct = viewModel?.pvProduct;
    const monthCode = viewModel?.monthCode;
    if (!currentProduct || !monthCode) return;

    const currentGroup = viewModel.group;
    if (!currentGroup) return;

    const currentSizeGroup = String(currentProduct["Förpackningsstorleksgrupp"] ?? '');
    const alternatives = [];

    for (const group of (viewModel.subGroups || [])) {
        const groupItems = getGroupMonthRows(group, monthCode);
        if (groupItems.length === 0) continue;

        const pvItem = groupItems.find(entry => getItemStatus(entry).trim().toUpperCase() === 'PV');
        const fallbackCheapest = groupItems.reduce((lowest, entry) => {
            if (!lowest) return entry;
            return toNumber(entry["Försäljningspris"]) < toNumber(lowest["Försäljningspris"]) ? entry : lowest;
        }, null);
        const representative = pvItem || fallbackCheapest;
        if (representative) alternatives.push(representative);
    }

    const hasOtherSizes = alternatives.some(item =>
        String(item["Förpackningsstorleksgrupp"] ?? '') !== currentSizeGroup
    );
    if (!hasOtherSizes) return;

    alternatives.sort((a, b) => toNumber(a.Storlek) - toNumber(b.Storlek));

    const compareValues = alternatives
        .map(item => {
            const sizeValue = toNumber(item.Storlek);
            const priceValue = toNumber(item["Försäljningspris"]);
            if (!Number.isFinite(sizeValue) || sizeValue <= 0 || !Number.isFinite(priceValue)) return null;
            return priceValue / sizeValue;
        })
        .filter(value => Number.isFinite(value));

    const minCompare = compareValues.length > 0 ? Math.min(...compareValues) : null;
    const maxCompare = compareValues.length > 0 ? Math.max(...compareValues) : null;

    const section = document.createElement('div');
    section.id = 'alt-package-sizes';
    section.className = 'bleed-card alt-package-sizes-card';

    const heading = document.createElement('div');
    heading.className = 'alt-package-sizes-heading';

    const title = document.createElement('h3');
    title.className = 'alt-package-sizes-title';
    title.textContent = 'Samma substans och styrka i andra förpackningsstorlekar';

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'alt-view-toggle';
    toggleBtn.innerHTML = '<span class="material-symbols-outlined">list</span>';

    const subtitle = document.createElement('p');
    subtitle.className = 'alt-package-sizes-subtitle';
    subtitle.textContent = 'Samma substans och styrka – jämför förpackningsstorlekar. Scrolla i sidled och klicka för att öppna.';

    const list = document.createElement('div');
    list.className = 'alt-package-sizes-list';

    const tableWrap = document.createElement('div');
    tableWrap.className = 'alt-package-sizes-table-wrap';

    const table = document.createElement('table');
    table.className = 'alt-package-sizes-table';
    table.innerHTML = `
        <thead>
            <tr>
                <th>Förpackning</th>
                <th>Pris</th>
                <th>Jmf pris</th>
                <th>Tillverkare</th>
            </tr>
        </thead>
    `;
    const tableBody = document.createElement('tbody');
    table.appendChild(tableBody);
    tableWrap.appendChild(table);

    const rows = [];

    alternatives.forEach(item => {
        const isCurrentSize = String(item["Förpackningsstorleksgrupp"] ?? '') === currentSizeGroup;

        const sizeValue = toNumber(item.Storlek);
        const priceValue = toNumber(item["Försäljningspris"]);
        const unit = formatUnitSingular(item.Beredningsform || currentProduct.Beredningsform || currentSearch?.form || '');
        const compareValue = Number.isFinite(sizeValue) && sizeValue > 0 && Number.isFinite(priceValue)
            ? (priceValue / sizeValue)
            : null;
        const comparePrice = Number.isFinite(compareValue)
            ? `${compareValue.toFixed(2).replace('.', ',')} kr/${unit}`
            : '—';
        const priceText = Number.isFinite(priceValue)
            ? `${priceValue.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`
            : '—';

        let compareClass = '';
        if (Number.isFinite(compareValue) && Number.isFinite(minCompare) && Number.isFinite(maxCompare) && minCompare !== maxCompare) {
            if (Math.abs(compareValue - minCompare) < 0.000001) compareClass = ' alt-compare-lowest';
            else if (Math.abs(compareValue - maxCompare) < 0.000001) compareClass = ' alt-compare-highest';
        }

        const sizeText = formatUnit(item.Beredningsform || currentProduct.Beredningsform || '', item.Storlek);
        const currentBadge = isCurrentSize ? '<span class="alt-current-badge">Visas nu</span>' : '';

        rows.push({
            item,
            isCurrentSize,
            compareClass,
            comparePrice,
            priceText,
            sizeText,
            currentBadge,
            company: item.Företag || '—'
        });
    });

    const goToItem = (item) => {
        fetchLatestPV({
            id: item["Utbytesgrupps ID"],
            size_id: item["Förpackningsstorleksgrupp"],
            sub: item.Substans,
            str: item.Styrka,
            form: item.Beredningsform,
            vnr: item.Varunummer || item.Vnr
        });
        window.scrollTo(0, 0);
    };

    rows.forEach(row => {
        const rowButton = document.createElement('button');
        rowButton.type = 'button';
        rowButton.className = 'alt-package-size-row';
        if (row.isCurrentSize) {
            rowButton.classList.add('is-current');
        }

        rowButton.innerHTML = `
            <div class="alt-package-size-main">
                <div class="alt-package-size-topline">
                    <strong>${row.sizeText}</strong>
                    ${row.currentBadge}
                </div>
                <span>${row.company}</span>
            </div>
            <div class="alt-package-size-prices">
                <span class="alt-price">${row.priceText}</span>
                <span class="alt-compare${row.compareClass}">${row.comparePrice}</span>
            </div>
        `;

        rowButton.addEventListener('click', () => goToItem(row.item));

        list.appendChild(rowButton);

        const tr = document.createElement('tr');
        tr.className = 'alt-package-size-table-row';
        if (row.isCurrentSize) tr.classList.add('is-current');
        tr.innerHTML = `
            <td>${row.sizeText} ${row.currentBadge}</td>
            <td>${row.priceText}</td>
            <td class="alt-table-compare${row.compareClass}">${row.comparePrice}</td>
            <td>${row.company}</td>
        `;
        tr.addEventListener('click', () => goToItem(row.item));
        tableBody.appendChild(tr);
    });

    const syncView = () => {
        const isTable = altPackageView === 'table';
        list.classList.toggle('is-hidden', isTable);
        tableWrap.classList.toggle('is-hidden', !isTable);
        const iconEl = toggleBtn.querySelector('.material-symbols-outlined');
        if (iconEl) {
            iconEl.textContent = isTable ? 'view_carousel' : 'list';
        }
        toggleBtn.setAttribute('aria-label', isTable ? 'Visa kortvy' : 'Visa tabellvy');
        toggleBtn.title = isTable ? 'Visa kortvy' : 'Visa tabellvy';
    };

    toggleBtn.addEventListener('click', () => {
        altPackageView = altPackageView === 'table' ? 'cards' : 'table';
        syncView();
    });

    heading.appendChild(title);
    heading.appendChild(toggleBtn);

    section.appendChild(heading);
    section.appendChild(subtitle);
    section.appendChild(list);
    section.appendChild(tableWrap);
    syncView();
    sectionContainer.appendChild(section);
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
            
            monthDiv.addEventListener('click', () => {
                DOM.monthPickerDropdown.style.display = 'none';
                updateMonth(monthCode);
                if (currentSearch) {
                    fetchLatestPV(currentSearch);
                }
            });
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

/**
 * Finds better package sizes of the same medicine that offer lower per-unit pricing.
 * @param {Object} selectedProduct - Currently selected medicine product
 * @param {Array<Object>} dataToSearch - All available products to compare
 * @returns {Object|null} Best deal object with size, savings percentage, and target size
 */
function findBetterPackageSize(selectedProduct, dataToSearch) {
    const selectedSize = toNumber(selectedProduct.Storlek);
    const selectedPrice = toNumber(selectedProduct["Försäljningspris"]);
    
    if (!Number.isFinite(selectedSize) || !Number.isFinite(selectedPrice) || selectedSize === 0) {
        return null;
    }

    const selectedPricePerUnit = selectedPrice / selectedSize;
    const substance = selectedProduct.Substans;
    const strength = selectedProduct.Styrka;
    const selectedVnr = selectedProduct.Varunummer || selectedProduct.Vnr;

    let bestDeal = null;
    const threshold = PACKAGE_SIZE_SAVINGS_THRESHOLD; // 5% threshold

    dataToSearch.forEach(item => {
        const itemStatus = getItemStatus(item);
        if (itemStatus !== "PV") return;
        if (item.Substans !== substance || item.Styrka !== strength) return;
        
        const itemVnr = item.Varunummer || item.Vnr;
        if (itemVnr === selectedVnr) return;

        const itemSize = toNumber(item.Storlek);
        const itemPrice = toNumber(item["Försäljningspris"]);

        if (!Number.isFinite(itemSize) || !Number.isFinite(itemPrice) || itemSize === 0) {
            return;
        }

        const itemPricePerUnit = itemPrice / itemSize;
        const savingsPercent = (selectedPricePerUnit - itemPricePerUnit) / selectedPricePerUnit;

        if (savingsPercent >= threshold && (!bestDeal || itemPricePerUnit < bestDeal.pricePerUnit)) {
            bestDeal = {
                size: `${itemSize} ${formatUnit(item.Beredningsform, itemSize).split(' ').slice(1).join(' ')}`,
                targetSize: itemSize,
                pricePerUnit: itemPricePerUnit,
                currentPricePerUnit: selectedPricePerUnit,
                savings: savingsPercent * 100
            };
        }
    });

    return bestDeal;
}

function loadMedicineFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const vnr = params.get('vnr');
    
    if (!vnr) {
        // No VNR in URL - show landing page
        document.body.classList.remove('has-selection');
        const existingAltSection = document.getElementById('alt-package-sizes');
        if (existingAltSection) existingAltSection.remove();
        const resultsDiv = DOM.resultsDiv;
        if (resultsDiv) {
            resultsDiv.innerHTML = '';
        }
        // Clear search bar
        const searchInput = DOM.searchInput;
        if (searchInput) {
            searchInput.value = '';
        }
        // Hide chart
        const chartCont = DOM.chartCont;
        if (chartCont) {
            chartCont.style.display = 'none';
        }
        return;
    }
    
    // Find the medicine in the search index by VNR
    const searchItem = searchIndex.find(item => 
        item.vnr && (Array.isArray(item.vnr) ? item.vnr.includes(vnr) : item.vnr === vnr)
    );
    
    if (searchItem) {
        // Set the first VNR from the array if it's an array
        if (Array.isArray(searchItem.vnr)) {
            searchItem.vnr = vnr;
        }
        fetchLatestPV(searchItem, true); // Skip pushState - we're loading from existing URL
    }
}

// Handle browser back/forward navigation
window.addEventListener('popstate', function(event) {
    const params = new URLSearchParams(window.location.search);
    const vnr = params.get('vnr');
    
    if (!vnr) {
        // No VNR - show landing page
        document.body.classList.remove('has-selection');
        const existingAltSection = document.getElementById('alt-package-sizes');
        if (existingAltSection) existingAltSection.remove();
        const resultsDiv = DOM.resultsDiv;
        if (resultsDiv) {
            resultsDiv.innerHTML = '';
        }
        // Clear search bar
        const searchInput = DOM.searchInput;
        if (searchInput) {
            searchInput.value = '';
        }
        // Hide chart
        const chartCont = DOM.chartCont;
        if (chartCont) {
            chartCont.style.display = 'none';
        }
        return;
    }
    
    if (event.state && event.state.searchItem) {
        currentSearch = event.state.searchItem;
        fetchLatestPV(event.state.searchItem, true); // Skip pushState to avoid duplicate history entries
    }
});

/**
 * Converts a value to number, handling Swedish decimal format (comma).
 * @param {*} value - Value to convert
 * @returns {number|null} Numeric value or null if conversion fails
 */
function toNumber(value) {
    if (value === null || value === undefined) return null;
    const numeric = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
    return Number.isFinite(numeric) ? numeric : null;
}

document.addEventListener('DOMContentLoaded', init);