let availableMonths = [];
let systemMonthCode = null;
let currentMonth = null;
let nextMonth = null;
const dataCache = new Map();

const currencyFormatter = new Intl.NumberFormat('sv-SE', {
    style: 'currency',
    currency: 'SEK',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});

const cacheBust = `v=${Date.now()}`;

// Dark mode initialization
if (localStorage.getItem('darkMode') === 'enabled') {
    document.body.classList.add('dark-mode');
}

document.addEventListener('DOMContentLoaded', () => {
    initStatistics();
});

// Dark mode toggle is handled in script.js - add listener to re-render on dark mode change
document.addEventListener('DOMContentLoaded', () => {
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    if (darkModeToggle) {
        darkModeToggle.addEventListener('click', () => {
            // Re-render when dark mode changes
            setTimeout(renderStatistics, 100);
        });
    }
});

async function initStatistics() {
    await loadMonths();

    const periodSelect = document.getElementById('stats-period');
    const limitSelect = document.getElementById('stats-limit');

    if (periodSelect) {
        periodSelect.addEventListener('change', renderStatistics);
    }

    if (limitSelect) {
        limitSelect.addEventListener('change', renderStatistics);
    }

    renderStatistics();
}

async function loadMonths() {
    const resMonths = await fetch(`data/months.json?${cacheBust}`);
    availableMonths = await resMonths.json();
    availableMonths.sort((a, b) => b - a);

    const now = new Date();
    const yy = now.getFullYear().toString().slice(-2);
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    systemMonthCode = parseInt(yy + mm, 10);

    if (availableMonths.includes(systemMonthCode)) {
        currentMonth = systemMonthCode;
    } else {
        currentMonth = availableMonths.reduce((closest, month) => {
            if (month <= systemMonthCode) {
                return !closest || month > closest ? month : closest;
            }
            return closest || month;
        }, null);
    }

    const currentIndex = availableMonths.indexOf(currentMonth);
    nextMonth = currentIndex > 0 ? availableMonths[currentIndex - 1] : null;
}

async function renderStatistics() {
    const periodValue = document.getElementById('stats-period')?.value || '12';
    const limitValue = parseInt(document.getElementById('stats-limit')?.value || '5', 10);

    const periodMonths = getPeriodMonths(periodValue);
    if (periodMonths.length === 0) return;

    updateRangeLabel(periodMonths);
    await renderSummary(periodMonths);
    await renderNextMonthChanges(limitValue);
    await renderAverageTrend(periodMonths);
}

function getPeriodMonths(periodValue) {
    if (periodValue === 'all') {
        return [...availableMonths];
    }
    const limit = parseInt(periodValue, 10);
    if (Number.isNaN(limit)) return [...availableMonths];
    return availableMonths.slice(0, limit);
}

function updateRangeLabel(months) {
    const label = document.getElementById('stats-range');
    if (!label) return;

    const sorted = [...months].sort((a, b) => a - b);
    const start = formatMedicineDate(sorted[0]);
    const end = formatMedicineDate(sorted[sorted.length - 1]);
    label.textContent = `Period: ${start} – ${end} (${months.length} månader)`;

    const headerPeriod = document.getElementById('header-period');
    if (headerPeriod) {
        headerPeriod.textContent = `TLV Periodens Varor • Statistik (${start} – ${end})`;
    }
}

async function renderSummary(months) {
    const summary = document.getElementById('stats-summary');
    if (!summary) return;

    const avgByMonth = await getAverageByMonth(months);
    const chronological = months.slice().reverse();
    const currentAvg = avgByMonth.get(currentMonth)?.avg ?? null;
    const prevMonth = chronological.length > 1 ? chronological[chronological.length - 2] : null;
    const prevAvg = prevMonth ? avgByMonth.get(prevMonth)?.avg ?? null : null;

    const trend = getTrendLabel(avgByMonth, chronological);
    const change = currentAvg && prevAvg ? ((currentAvg - prevAvg) / prevAvg) * 100 : null;

    summary.replaceChildren(
        buildSummaryCard('Aktuell månad', formatMedicineDate(currentMonth), formatPrice(currentAvg), 'calendar_month'),
        buildSummaryCard('Trend', trend.label, trend.detail, trend.icon),
        buildSummaryCard('Förändring mot föregående', change ? `${formatSigned(change)}%` : '–', 'Jämfört med förra månaden', 'swap_vert')
    );
}

function buildSummaryCard(title, value, subtext, icon) {
    const card = document.createElement('div');
    card.className = 'stats-summary-card';

    const iconEl = document.createElement('span');
    iconEl.className = 'material-symbols-outlined stats-summary-icon';
    iconEl.textContent = icon;

    const content = document.createElement('div');
    content.className = 'stats-summary-content';

    const label = document.createElement('p');
    label.className = 'stats-summary-label';
    label.textContent = title;

    const valueEl = document.createElement('p');
    valueEl.className = 'stats-summary-value';
    valueEl.textContent = value;

    const sub = document.createElement('p');
    sub.className = 'stats-summary-subtext';
    sub.textContent = subtext;

    content.append(label, valueEl, sub);
    card.append(iconEl, content);

    return card;
}

async function renderNextMonthChanges(limit) {
    const increaseContainer = document.getElementById('stats-increase-list');
    const decreaseContainer = document.getElementById('stats-decrease-list');

    if (!increaseContainer || !decreaseContainer) return;

    increaseContainer.replaceChildren(buildLoadingState());
    decreaseContainer.replaceChildren(buildLoadingState());

    if (!currentMonth || !nextMonth) {
        renderEmptyState(increaseContainer, 'Ingen kommande månad finns i datat.');
        renderEmptyState(decreaseContainer, 'Ingen kommande månad finns i datat.');
        return;
    }

    const currentData = await fetchMonthData(currentMonth);
    const nextData = await fetchMonthData(nextMonth);

    const currentMap = buildVariantMap(currentData);
    const nextMap = buildVariantMap(nextData);

    const changes = [];
    nextMap.forEach((nextPriceValue, key) => {
        const currentEntry = currentMap.get(key);
        if (!Number.isFinite(currentEntry?.price)) return;
        const diff = nextPriceValue.price - currentEntry.price;
        const item = nextPriceValue.item;
        changes.push({
            id: key,
            name: item.Substans || 'Okänt ämne',
            substance: item.Substans || '',
            strength: item.Styrka || '–',
            size: formatUnit(item.Beredningsform, item.Storlek) || '–',
            currentPrice: currentEntry.price,
            nextPrice: nextPriceValue.price,
            diff
        });
    });

    const increases = changes.filter(item => item.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, limit);
    const decreases = changes.filter(item => item.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, limit);

    renderList(increaseContainer, increases, buildChangeItem);
    renderList(decreaseContainer, decreases, buildChangeItem);
}

async function renderAverageTrend(months) {
    const container = document.getElementById('stats-average');
    if (!container) return;

    container.replaceChildren(buildLoadingState());

    const avgByMonth = await getAverageByMonth(months);
    const chronological = months.slice().reverse();
    const values = chronological.map(month => avgByMonth.get(month)?.avg).filter(value => Number.isFinite(value));

    if (values.length === 0) {
        renderEmptyState(container, 'Kunde inte räkna ut genomsnitt för perioden.');
        return;
    }

    const sparkline = createSparkline(values);
    const trend = getTrendLabel(avgByMonth, chronological);

    container.replaceChildren();
    const wrapper = document.createElement('div');
    wrapper.className = 'stats-average-wrapper';

    const chart = document.createElement('div');
    chart.className = 'stats-sparkline';
    chart.innerHTML = sparkline;

    const info = document.createElement('div');
    info.className = 'stats-average-info';

    const trendTitle = document.createElement('p');
    trendTitle.className = 'stats-average-title';
    trendTitle.textContent = trend.label;

    const trendDetail = document.createElement('p');
    trendDetail.className = 'stats-average-subtext';
    trendDetail.textContent = trend.detail;

    const list = document.createElement('div');
    list.className = 'stats-average-list';
    chronological.slice(-6).forEach(month => {
        const row = document.createElement('div');
        row.className = 'stats-average-row';

        const label = document.createElement('span');
        label.textContent = formatShortMonth(month);

        const value = document.createElement('span');
        value.textContent = formatPrice(avgByMonth.get(month)?.avg ?? null);

        row.append(label, value);
        list.appendChild(row);
    });

    info.append(trendTitle, trendDetail, list);
    wrapper.append(chart, info);
    container.appendChild(wrapper);
}

async function getAverageByMonth(months) {
    const avgByMonth = new Map();

    for (const month of months) {
        const data = await fetchMonthData(month);
        let sum = 0;
        let count = 0;

        data.forEach(item => {
            const price = toNumber(item["Försäljningspris"]);
            if (!Number.isFinite(price)) return;
            sum += price;
            count += 1;
        });

        avgByMonth.set(month, {
            avg: count > 0 ? sum / count : null,
            count
        });
    }

    return avgByMonth;
}

function getTrendLabel(avgByMonth, chronological) {
    const values = chronological.map(month => avgByMonth.get(month)?.avg).filter(value => Number.isFinite(value));
    if (values.length < 2) {
        return { label: 'Trend saknas', detail: 'För få datapunkter', icon: 'query_stats' };
    }

    const first = values[0];
    const last = values[values.length - 1];
    const diff = last - first;
    const diffPercent = first ? (diff / first) * 100 : 0;

    if (Math.abs(diffPercent) < 1) {
        return { label: 'Stabil prisnivå', detail: 'Små förändringar över tid', icon: 'trending_flat' };
    }

    if (diffPercent > 0) {
        return { label: 'Stigande prisnivå', detail: `+${diffPercent.toFixed(1)}% sedan periodens start`, icon: 'trending_up' };
    }

    return { label: 'Sjunkande prisnivå', detail: `${diffPercent.toFixed(1)}% sedan periodens start`, icon: 'trending_down' };
}

function buildFluctuationItem(item) {
    const title = `${item.name}`;
    const subtitle = formatMeta(item);
    const metric = `${formatPrice(item.range)} spann`;
    const detail = `${formatPrice(item.min)} – ${formatPrice(item.max)}`;

    return buildListItem(title, subtitle, metric, detail);
}

function buildChangeItem(item) {
    const title = `${item.name}`;
    const subtitle = `${item.strength} • ${item.size}`;
    const percentChange = item.currentPrice ? ((item.diff / item.currentPrice) * 100).toFixed(1) : '0';
    const metric = `${formatSigned(item.diff)} kr (${formatSigned(parseFloat(percentChange))}%)`;
    const detail = `${formatPrice(item.currentPrice)} → ${formatPrice(item.nextPrice)}`;

    return buildListItem(title, subtitle, metric, detail, item.diff);
}

function buildListItem(title, subtitle, metric, detail, diffValue) {
    const item = document.createElement('div');
    item.className = 'stats-list-item';

    const text = document.createElement('div');

    const titleEl = document.createElement('div');
    titleEl.className = 'stats-item-title';
    titleEl.textContent = title;

    const subtitleEl = document.createElement('div');
    subtitleEl.className = 'stats-item-subtitle';
    subtitleEl.textContent = subtitle || '—';

    text.append(titleEl, subtitleEl);

    const metrics = document.createElement('div');
    metrics.className = 'stats-item-metrics';

    const metricEl = document.createElement('div');
    metricEl.className = 'stats-item-metric';

    const metricValue = document.createElement('span');
    metricValue.className = 'stats-item-metric-value';
    metricValue.textContent = metric;
    if (typeof diffValue === 'number') {
        metricValue.classList.add(diffValue < 0 ? 'metric-negative' : 'metric-positive');
    }

    const metricDetail = document.createElement('span');
    metricDetail.className = 'stats-item-metric-detail';
    metricDetail.textContent = detail;

    metricEl.append(metricValue, metricDetail);
    metrics.appendChild(metricEl);

    item.append(text, metrics);
    return item;
}

function renderList(container, items, builder) {
    container.replaceChildren();
    if (!items || items.length === 0) {
        renderEmptyState(container, 'Inga träffar i perioden.');
        return;
    }

    items.forEach(item => {
        container.appendChild(builder(item));
    });
}

function renderEmptyState(container, message) {
    const empty = document.createElement('div');
    empty.className = 'stats-empty';
    empty.textContent = message;
    container.appendChild(empty);
}

function buildLoadingState() {
    const loading = document.createElement('div');
    loading.className = 'stats-loading';
    loading.textContent = 'Laddar statistik...';
    return loading;
}

function createSparkline(values) {
    const width = 200;
    const height = 60;
    const padding = 6;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const points = values.map((value, index) => {
        const x = padding + (index / (values.length - 1 || 1)) * (width - padding * 2);
        const y = height - padding - ((value - min) / range) * (height - padding * 2);
        return `${x},${y}`;
    }).join(' ');

    return `
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Pris trend">
            <polyline points="${points}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
    `;
}

async function fetchMonthData(month) {
    if (!month) return [];
    if (dataCache.has(month)) return dataCache.get(month);

    const res = await fetch(`data/${month}.json?${cacheBust}`);
    const data = await res.json();
    dataCache.set(month, data);
    return data;
}

function formatMedicineDate(monthCode) {
    const codeStr = String(monthCode);
    const year = codeStr.substring(0, 2);
    const monthIndex = codeStr.substring(2, 4);
    const months = ["Januari", "Februari", "Mars", "April", "Maj", "Juni", "Juli", "Augusti", "September", "Oktober", "November", "December"];
    const fullYear = 2000 + parseInt(year, 10);
    const monthName = months[parseInt(monthIndex, 10) - 1];
    return monthName ? `${monthName} ${fullYear}` : "Okänt datum";
}

function formatShortMonth(monthCode) {
    const codeStr = String(monthCode);
    const year = codeStr.substring(0, 2);
    const monthIndex = codeStr.substring(2, 4);
    const months = ["Jan", "Feb", "Mar", "Apr", "Maj", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];
    const fullYear = 2000 + parseInt(year, 10);
    const monthName = months[parseInt(monthIndex, 10) - 1];
    return monthName ? `${monthName} ${fullYear}` : "Okänt";
}

function formatPrice(value) {
    if (!Number.isFinite(value)) return '–';
    return currencyFormatter.format(value);
}

function formatSigned(value) {
    if (!Number.isFinite(value)) return '–';
    const rounded = value.toFixed(2).replace('.', ',');
    return `${value > 0 ? '+' : ''}${rounded}`;
}

function formatMeta(item) {
    return item.substance ? 'Genomsnitt per substans' : 'Substans saknas';
}

function buildSubstanceAverages(data) {
    const totals = new Map();
    const counts = new Map();

    data.forEach(item => {
        const substance = item?.Substans || 'Okänt ämne';
        const price = toNumber(item["Försäljningspris"]);
        if (!Number.isFinite(price)) return;
        totals.set(substance, (totals.get(substance) || 0) + price);
        counts.set(substance, (counts.get(substance) || 0) + 1);
    });

    const averages = new Map();
    totals.forEach((total, substance) => {
        const count = counts.get(substance) || 0;
        averages.set(substance, count > 0 ? total / count : null);
    });

    return averages;
}

function buildVariantMap(data) {
    const variantMap = new Map();

    data.forEach(item => {
        if (!isPVItem(item)) return;
        const price = toNumber(item["Försäljningspris"]);
        if (!Number.isFinite(price)) return;

        const substance = item?.Substans || 'Okänt ämne';
        const strength = item?.Styrka || '–';
        const form = item?.Beredningsform || '';
        const size = item?.Storlek ?? 0;
        const key = `${substance}|${strength}|${form}|${size}`;

        let entry = variantMap.get(key);
        if (!entry) {
            entry = { price: 0, count: 0, item };
        }
        entry.price += price;
        entry.count += 1;
        variantMap.set(key, entry);
    });

    const averaged = new Map();
    variantMap.forEach((entry, key) => {
        averaged.set(key, {
            price: entry.count > 0 ? entry.price / entry.count : entry.price,
            item: entry.item
        });
    });

    return averaged;
}

// formatUnit and getItemStatus are defined in script.js and available globally

function isPVItem(item) {
    return getItemStatus(item) === "PV";
}

function toNumber(value) {
    if (value === null || value === undefined) return null;
    const numeric = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
    return Number.isFinite(numeric) ? numeric : null;
}
