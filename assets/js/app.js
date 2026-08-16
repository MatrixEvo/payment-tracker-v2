// app.js
(() => {
    // ==========================================
    // CORE STATE & UTILS
    // ==========================================
    const $ = id => document.getElementById(id);
    const STORAGE_KEY = 'paytrack';
    const SETTINGS_KEY = 'paytrack_forecast_settings';
    
    let data = { methods: [], entries: [], categories: [] };
    let currentTrackerMonth = new Date();
    let currentActiveView = 'view-analytics';
    
    // Vendor Instances
    let methodSortable = null;
    let entrySortables = [];
    let calendar = null;
    let forecastChart = null;
    let categoryChart = null, methodChart = null, trendChart = null;
    let activeModal = null; // Currently open bootstrap modal
    let currentAnalyticsDate = new Date();

    const formatCurrency = (val) => new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(val);
    const escapeHTML = (str) => String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag]));
    
    const uuid = () => {
        if (crypto.randomUUID) return crypto.randomUUID();
        const b = crypto.getRandomValues(new Uint8Array(16));
        b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
        return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    };

    const monthKey = date => `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}`;

    function getForecastTotalMonths() {
        const start = new Date();
        const targetYear = start.getFullYear() + 10;
        return (targetYear - start.getFullYear()) * 12 + (11 - start.getMonth()) + 1;
    }

    const formatMonth = d => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    function getVersioned(map = {}, fallback, month) {
        const ks = Object.keys(map).filter(k => k <= month).sort();
        return ks.length ? map[ks.pop()] : fallback;
    }
    const getMethodName = (m, month) => getVersioned(m.names, m.name, month);
    function getAssignment(entry, monthKey) {
        if (!entry.assignments) entry.assignments = {};
        const keys = Object.keys(entry.assignments).sort();
        let current = null;
        for (let k of keys) {
            if (k <= monthKey) current = entry.assignments[k];
        }
        return current || entry.method || data.methods[0]?.id;
    }
    
    function getOriginalAssignment(entry, monthKey) {
        if (!entry.assignments) return entry.method || data.methods[0]?.id;
        const keys = Object.keys(entry.assignments).sort();
        let current = null;
        for (let k of keys) {
            if (k <= monthKey && entry.assignments[k] !== 'DELETED') current = entry.assignments[k];
        }
        return current || entry.method || data.methods[0]?.id;
    }
    const getOrder = (e, month) => +getVersioned(e.order, 0, month);

    // New Helper: Check if entry is active in a given month
    function isEntryActiveInMonth(entry, mk) {
        if (getAssignment(entry, mk) === 'DELETED') return false; 
        if (entry.startMonth && mk < entry.startMonth) return false;
        
        if (entry.type === 'one-off') {
            return mk === entry.startMonth;
        } else {
            if (entry.endMonth && mk > entry.endMonth) return false;
            return true;
        }
    }

    function loadData() {
        const s = localStorage.getItem(STORAGE_KEY);
        if (s) {
            data = JSON.parse(s);
            if (!data.categories) data.categories = [];
        }

        // Initialize default categories if missing
        if (!data.categories.length) {
            data.categories = [
                { id: 'cat-housing', name: 'Housing', color: '#60a5fa' },
                { id: 'cat-utilities', name: 'Utilities', color: '#facc15' },
                { id: 'cat-subscriptions', name: 'Subscriptions', color: '#c084fc' },
                { id: 'cat-food', name: 'Food & Dining', color: '#4ade80' },
                { id: 'cat-transport', name: 'Transportation', color: '#fb923c' },
                { id: 'cat-debt', name: 'Debt / Loans', color: '#f87171' },
                { id: 'cat-personal', name: 'Personal Care', color: '#38bdf8' },
                { id: 'cat-entertainment', name: 'Entertainment', color: '#818cf8' },
                { id: 'cat-savings', name: 'Savings / Investments', color: '#34d399' },
                { id: 'cat-shopping', name: 'Shopping', color: '#ec4899' },
                { id: 'cat-health', name: 'Health & Medical', color: '#f43f5e' },
                { id: 'cat-education', name: 'Education', color: '#a855f7' },
                { id: 'cat-family', name: 'Family / Kids', color: '#14b8a6' },
                { id: 'cat-insurance', name: 'Insurance', color: '#0ea5e9' },
                { id: 'cat-misc', name: 'Misc', color: '#9ca3af' }
            ];
        }

        // Data Migration for Next Level Features
        const defaultMethodColors = ['#38bdf8', '#818cf8', '#34d399', '#f472b6', '#a78bfa', '#fbbf24', '#f87171'];
        if (!data.methods.length) {
            const mon = monthKey(currentTrackerMonth);
            data.methods.push({ id: 'method-cash', name: 'Cash', names: { [mon]: 'Cash' }, color: '#38bdf8' });
        } else {
            data.methods.forEach((m, i) => {
                if (!m.color) m.color = defaultMethodColors[i % defaultMethodColors.length];
            });
        }
        
        data.entries.forEach(e => {
            if (!e.category) e.category = 'cat-misc';
            // Migrate legacy category strings to IDs if needed
            if (e.category && !e.category.startsWith('cat-')) {
                const mapped = data.categories.find(c => c.name.toLowerCase() === e.category.toLowerCase());
                e.category = mapped ? mapped.id : 'cat-misc';
            }
            if (!e.type) e.type = 'recurring';
            if (!e.startMonth) e.startMonth = '2024-01';
        });
    }
    function saveData() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        triggerViewUpdate();
    }

    // ==========================================
    // SPA    // ==========================================
    // ANALYTICS VIEW LOGIC
    // ==========================================
    function initAnalytics() {
        $('prevAnalyticsMonth').onclick = () => { currentAnalyticsDate.setMonth(currentAnalyticsDate.getMonth() - 1); renderAnalytics(); };
        $('nextAnalyticsMonth').onclick = () => { currentAnalyticsDate.setMonth(currentAnalyticsDate.getMonth() + 1); renderAnalytics(); };
        $('resetAnalyticsMonth').onclick = () => { currentAnalyticsDate = new Date(); renderAnalytics(); };
    }

    function renderAnalytics() {
        const mk = monthKey(currentAnalyticsDate);
        $('analyticsMonthStr').textContent = currentAnalyticsDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        
        const activeEntries = data.entries.filter(e => isEntryActiveInMonth(e, mk));
        
        const catTotals = {};
        const methodTotals = {};
        
        let currentMonthTotal = 0;
        
        activeEntries.forEach(e => {
            currentMonthTotal += e.amount;
            catTotals[e.category] = (catTotals[e.category] || 0) + e.amount;
            
            const mId = getAssignment(e, mk) || 'method-cash';
            methodTotals[mId] = (methodTotals[mId] || 0) + e.amount;
        });

        // MoM Comparison
        let prevDate = new Date(currentAnalyticsDate);
        prevDate.setMonth(prevDate.getMonth() - 1);
        const prevMk = monthKey(prevDate);
        const prevEntries = data.entries.filter(e => isEntryActiveInMonth(e, prevMk));
        const prevMonthTotal = prevEntries.reduce((s, e) => s + e.amount, 0);
        
        const forecastSettings = getForecastSettings();
        const monthlyIncome = forecastSettings.monthlyIncome || 0;
        
        $('analyticsTotalSpending').textContent = 'RM ' + currentMonthTotal.toFixed(2);
        
        if ($('analyticsTotalIncome')) $('analyticsTotalIncome').textContent = 'RM ' + monthlyIncome.toFixed(2);
        if ($('analyticsTotalExpense')) $('analyticsTotalExpense').textContent = 'RM ' + currentMonthTotal.toFixed(2);
        
        let incPct = 50, expPct = 50;
        if (monthlyIncome > 0 || currentMonthTotal > 0) {
            incPct = (monthlyIncome / (monthlyIncome + currentMonthTotal)) * 100;
            expPct = (currentMonthTotal / (monthlyIncome + currentMonthTotal)) * 100;
        }
        if ($('analyticsIncomeBar')) $('analyticsIncomeBar').style.width = incPct + '%';
        if ($('analyticsExpenseBar')) $('analyticsExpenseBar').style.width = expPct + '%';
        
        if (prevMonthTotal === 0) {
            $('analyticsMoM').innerHTML = `<span class="text-slate-400">No data for last month</span>`;
        } else {
            const diff = currentMonthTotal - prevMonthTotal;
            const pct = (diff / prevMonthTotal) * 100;
            if (diff > 0) {
                $('analyticsMoM').innerHTML = `<span class="text-red-500 font-bold flex items-center justify-center gap-1"><i data-lucide="arrow-up-right" class="w-4 h-4"></i> ${pct.toFixed(1)}%</span> <span class="text-slate-400 text-sm">vs last month</span>`;
            } else if (diff < 0) {
                $('analyticsMoM').innerHTML = `<span class="text-green-500 font-bold flex items-center justify-center gap-1"><i data-lucide="arrow-down-right" class="w-4 h-4"></i> ${Math.abs(pct).toFixed(1)}%</span> <span class="text-slate-400 text-sm">vs last month</span>`;
            } else {
                $('analyticsMoM').innerHTML = `<span class="text-slate-400 font-bold">0%</span> <span class="text-slate-400 text-sm">vs last month</span>`;
            }
        }

        // Top 6 Expenses
        const topExpenses = [...activeEntries].sort((a, b) => b.amount - a.amount).slice(0, 6);
        const topContainer = $('analyticsTopExpenses');
        topContainer.innerHTML = '';
        if (topExpenses.length === 0) {
            topContainer.innerHTML = `<div class="text-slate-400 text-center my-3">No expenses this month.</div>`;
        } else {
            topExpenses.forEach((e, idx) => {
                const catObj = data.categories.find(c => c.id === e.category) || { name: 'Misc', color: '#9ca3af' };
                const div = document.createElement('div');
                div.className = 'flex justify-between items-center bg-black/20 p-3 rounded-lg border border-white/5';
                div.innerHTML = `
                    <div class="flex items-center gap-3 overflow-hidden">
                        <div class="text-slate-400 font-bold w-5">#${idx + 1}</div>
                        <span class="px-2 py-0.5 text-xs rounded-md whitespace-nowrap" style="background-color: ${catObj.color}20; color: ${catObj.color}; border: 1px solid ${catObj.color}40;">${escapeHTML(catObj.name)}</span>
                        <span class="truncate max-w-[120px] md:max-w-[150px] font-medium text-slate-200">${escapeHTML(e.item)}</span>
                    </div>
                    <div class="font-bold whitespace-nowrap text-right">RM ${e.amount.toFixed(2)}</div>
                `;
                topContainer.appendChild(div);
            });
        }

        const catLabels = [];
        const catData = [];
        const catColors = [];

        Object.keys(catTotals).forEach(catId => {
            const cat = data.categories.find(c => c.id === catId);
            if (cat) {
                catLabels.push(cat.name);
                catData.push(catTotals[catId]);
                catColors.push(cat.color);
            }
        });

        const ctxCat = $('categoryChart').getContext('2d');
        if (categoryChart) categoryChart.destroy();
        categoryChart = new Chart(ctxCat, {
            type: 'doughnut',
            data: {
                labels: catLabels,
                datasets: [{
                    data: catData,
                    backgroundColor: catColors,
                    borderWidth: 0
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#cbd5e1' } } } }
        });

        const methodLabels = [];
        const methodData = [];
        const methodColors = [];

        Object.keys(methodTotals).forEach(mId => {
            const m = data.methods.find(x => x.id === mId);
            if (m) {
                methodLabels.push(getMethodName(m, mk));
                methodData.push(methodTotals[mId]);
                methodColors.push(m.color || '#9ca3af');
            }
        });

        const ctxMethod = $('methodChart').getContext('2d');
        if (methodChart) methodChart.destroy();
        methodChart = new Chart(ctxMethod, {
            type: 'doughnut',
            data: {
                labels: methodLabels,
                datasets: [{
                    data: methodData,
                    backgroundColor: methodColors,
                    borderWidth: 0
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#cbd5e1' } } } }
        });

        // 25-Month Trend
        const trendLabels = [];
        const trendData = [];
        let cursor = new Date(currentAnalyticsDate);
        cursor.setMonth(cursor.getMonth() - 12);
        
        for (let i = 0; i < 25; i++) {
            const cmk = monthKey(cursor);
            trendLabels.push(cursor.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
            
            const entries = data.entries.filter(e => isEntryActiveInMonth(e, cmk) && getAssignment(e, cmk) !== 'DELETED');
            const sum = entries.reduce((s, e) => s + e.amount, 0);
            trendData.push(sum);
            
            cursor.setMonth(cursor.getMonth() + 1);
        }

        const ctxTrend = $('trendChart').getContext('2d');
        if (trendChart) trendChart.destroy();
        trendChart = new Chart(ctxTrend, {
            type: 'bar',
            data: {
                labels: trendLabels,
                datasets: [{ label: 'Total Spending', data: trendData, backgroundColor: 'rgba(99, 102, 241, 0.7)', borderRadius: 4 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.1)' }, ticks: { color: '#cbd5e1' } }, x: { grid: { display: false }, ticks: { color: '#cbd5e1' } } } }
        });
    }

    // ==========================================
    // INITIALIZATION & ROUTING
    // ==========================================
    function initRouter() {
        document.querySelectorAll('.nav-link-custom').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const viewId = link.getAttribute('data-view');
                document.querySelectorAll('.view-container').forEach(v => v.classList.remove('active'));
                document.querySelectorAll('.nav-link-custom').forEach(l => l.classList.remove('active'));
                
                $(viewId).classList.add('active');
                link.classList.add('active');
                
                currentActiveView = viewId;
                triggerViewUpdate();
                
                if (viewId === 'view-calendar' && calendar) {
                    calendar.render();
                }
            });
        });
    }

    function triggerViewUpdate() {
        if (currentActiveView === 'view-tracker') renderTracker();
        else if (currentActiveView === 'view-calendar' && calendar) calendar.refetchEvents();
        else if (currentActiveView === 'view-forecast') renderForecast();
        else if (currentActiveView === 'view-analytics') renderAnalytics();
        else if (currentActiveView === 'view-categories') renderCategories();
        else if (currentActiveView === 'view-methods') renderMethods();
        
        if (window.lucide) lucide.createIcons();
    }

    window.addEventListener('DOMContentLoaded', () => {
        loadData();
        initRouter();
        initTracker();
        initCalendar();
        initAnalytics();
        initForecast();
        initCategories();
        initMethods();
        
        const fs = getForecastSettings();
        $('startingBalance').value = fs.startingBalance || '';
        $('monthlyIncome').value = fs.monthlyIncome || '';
        $('incomeGrowth').value = fs.incomeGrowth || '';
        $('expenseInflation').value = fs.expenseInflation || '';
        
        $('configForm').onsubmit = (e) => {
            e.preventDefault();
            const s = getForecastSettings();
            s.startingBalance = parseFloat($('startingBalance').value) || 0;
            s.monthlyIncome = parseFloat($('monthlyIncome').value) || 0;
            s.incomeGrowth = parseFloat($('incomeGrowth').value) || 0;
            s.expenseInflation = parseFloat($('expenseInflation').value) || 0;
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
            renderForecast();
        };

        $('oneOffForm').onsubmit = (e) => {
            e.preventDefault();
            const s = getForecastSettings();
            s.oneOffEvents.push({
                name: $('oneOffName').value.trim(),
                amount: parseFloat($('oneOffAmount').value),
                monthKey: $('oneOffMonth').value
            });
            s.oneOffEvents.sort((a,b) => a.monthKey.localeCompare(b.monthKey));
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
            $('oneOffForm').reset();
            triggerViewUpdate();
        };

        document.querySelectorAll('input[name="forecastViewToggle"]').forEach(el => {
            el.addEventListener('change', renderForecast);
        });
        
        // Ensure starting view renders correctly
        triggerViewUpdate();
    });
    // ==========================================
    // TRACKER VIEW LOGIC
    // ==========================================
    function initTracker() {
        const syncCal = () => { if (calendar) calendar.gotoDate(currentTrackerMonth); };
        $('prevMonth').onclick = () => { currentTrackerMonth.setMonth(currentTrackerMonth.getMonth() - 1); renderTracker(); syncCal(); };
        $('nextMonth').onclick = () => { currentTrackerMonth.setMonth(currentTrackerMonth.getMonth() + 1); renderTracker(); syncCal(); };
        $('resetTrackerMonth').onclick = () => { currentTrackerMonth = new Date(); renderTracker(); syncCal(); };
    }

    function renderTracker() {
        const mon = monthKey(currentTrackerMonth);
        const today = new Date().getDate();
        const currentYear = currentTrackerMonth.getFullYear();
        const currentMonthIndex = currentTrackerMonth.getMonth();
        const daysInCurrentMonth = new Date(currentYear, currentMonthIndex + 1, 0).getDate();

        $('currentMonthStr').textContent = formatMonth(currentTrackerMonth);
        const c = $('methodsContainer');
        c.innerHTML = '';

        if (!data.methods.length) {
            $('addEntryBtn').disabled = true;
            c.innerHTML = `<div class="bg-slate-800 border border-white/10 rounded-xl p-6 text-center text-slate-400 py-12"><i data-lucide="inbox" class="w-12 h-12 mx-auto mb-4 opacity-50"></i>No payment methods yet.<br>Go to the <strong>Methods</strong> tab to add one before tracking entries.</div>`;
            ['totalAmount', 'paidAmount', 'dueAmount'].forEach(id => $(id).textContent = 'RM 0.00');
            methodSortable?.destroy();
            entrySortables.forEach(s => s.destroy());
            return;
        }
        $('addEntryBtn').disabled = false;

        let grandTotal = 0, grandPaid = 0;

        data.methods.forEach(m => {
            const items = data.entries
                .filter(e => {
                    if (e.startMonth && mon < e.startMonth) return false;
                    if (e.type !== 'one-off' && e.endMonth && mon > e.endMonth) return false;
                    if (e.type === 'one-off' && mon !== e.startMonth) return false;
                    
                    const assignedMethod = getOriginalAssignment(e, mon);
                    return assignedMethod === m.id;
                })
                .sort((a, b) => getOrder(a, mon) - getOrder(b, mon));

            let subTotal = 0, subPaid = 0;
            items.forEach(i => {
                const isDeleted = getAssignment(i, mon) === 'DELETED';
                if (!isDeleted) {
                    subTotal += i.amount;
                    if (i.paid && i.paid[mon]) subPaid += i.amount;
                }
            });
            const subDue = subTotal - subPaid;
            grandTotal += subTotal;
            grandPaid += subPaid;

            const card = document.createElement('div');
            card.className = 'premium-card mb-4';
            card.dataset.methodId = m.id;
            
            card.innerHTML = `
                <div class="flex justify-between items-center mb-4">
                    <div class="flex items-center gap-3">
                        <i data-lucide="grip" class="drag-handle-method text-slate-400 cursor-grab w-5 h-5"></i>
                        <h4 class="m-0 text-lg font-bold">${escapeHTML(getMethodName(m, mon))}</h4>
                    </div>
                    <div class="flex items-center gap-4 ml-auto">
                        <div class="text-right hidden sm:block">
                            <small class="text-slate-400 block whitespace-nowrap">Due: RM ${subDue.toFixed(2)} | Paid: RM ${subPaid.toFixed(2)}</small>
                            <span class="font-bold text-accent whitespace-nowrap">Total: RM ${subTotal.toFixed(2)}</span>
                        </div>
                    </div>
                </div>
                <ul class="flex flex-col gap-2"></ul>
            `;
            c.append(card);

            const ul = card.querySelector('ul');
            if (items.length) {
                items.forEach(i => {
                    const li = document.createElement('li');
                    li.dataset.entryId = i.id;

                    const isDeleted = getAssignment(i, mon) === 'DELETED';
                    const isPaid = Boolean(i.paid?.[mon]);
                    const effectiveDueDay = Math.min(i.dueDay, daysInCurrentMonth);
                    
                    const currentMonthDate = new Date();
                    const currentMonthStr = monthKey(currentMonthDate);
                    const isPastMonth = mon < currentMonthStr;
                    const isFutureMonth = mon > currentMonthStr;
                    const isOverdue = !isPaid && !isDeleted && (isPastMonth || (!isFutureMonth && today > effectiveDueDay));
                    
                    li.className = `flex flex-wrap gap-y-3 justify-between items-center p-3 rounded-lg bg-black/20 border border-white/5 transition-all hover:bg-black/40 group ${isDeleted ? 'opacity-40 grayscale' : ''}`;
                    
                    if (isOverdue) li.classList.add('border-red-500/50', 'bg-red-500/10');

                    const catObj = data.categories.find(c => c.id === i.category) || { name: 'Misc', color: '#9ca3af' };

                    li.innerHTML = `
                        <div class="flex flex-wrap items-center gap-2 flex-grow pr-2">
                            <i data-lucide="grip-vertical" class="drag-handle-entry text-slate-500 cursor-grab w-4 h-4 opacity-50 group-hover:opacity-100 flex-shrink-0" aria-hidden="true"></i>
                            <input class="w-4 h-4 rounded border-white/10 bg-black/20 text-sky-500 focus:ring-sky-500/25 cursor-pointer entry-checkbox flex-shrink-0" type="checkbox" aria-label="Mark ${escapeHTML(i.item)} as paid" ${isPaid ? 'checked' : ''} ${isDeleted ? 'disabled' : ''}>
                            <span class="${isPaid ? 'line-through text-slate-500' : 'font-medium'} ${isDeleted ? 'line-through' : ''} truncate max-w-[150px] sm:max-w-none" title="${escapeHTML(i.item)}">${escapeHTML(i.item)}</span>
                            <span class="px-2 py-0.5 text-xs rounded-md font-medium whitespace-nowrap flex-shrink-0" style="background-color: ${catObj.color}20; color: ${catObj.color}; border: 1px solid ${catObj.color}40;">${escapeHTML(catObj.name)}</span>
                        </div>
                        <div class="flex flex-wrap items-center gap-2 sm:gap-3 flex-shrink-0 ml-auto">
                            <span class="px-2 py-1 text-xs rounded-md bg-white/10 text-slate-400 whitespace-nowrap">Due: ${i.dueDay}</span>
                            <span class="font-bold w-auto min-w-[4rem] text-right whitespace-nowrap">RM ${i.amount.toFixed(2)}</span>
                            <button class="bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white p-1.5 rounded-md transition-all edit-entry flex-shrink-0" aria-label="Edit ${escapeHTML(i.item)}"><i data-lucide="pencil" class="w-4 h-4"></i></button>
                        </div>
                    `;
                    
                    li.querySelector('.entry-checkbox').onchange = () => togglePaid(i.id);
                    li.querySelector('.edit-entry').onclick = () => window.openEntryModal(i.id, new Date(currentYear, currentMonthIndex, i.dueDay));
                    ul.append(li);
                });
            } else {
                ul.innerHTML = `<li class="p-3 text-slate-400 text-center text-sm border border-dashed border-white/10 rounded-lg bg-white/5">No entries</li>`;
            }
        });

        $('totalAmount').textContent = `RM ${grandTotal.toFixed(2)}`;
        $('paidAmount').textContent = `RM ${grandPaid.toFixed(2)}`;
        $('dueAmount').textContent = `RM ${(grandTotal - grandPaid).toFixed(2)}`;

        // Drag & Drop
        methodSortable?.destroy();
        entrySortables.forEach(s => s.destroy());
        entrySortables = [];

        methodSortable = Sortable.create(c, {
            animation: 150, handle: '.drag-handle-method',
            onEnd: () => {
                const ids = [...c.children].map(ch => ch.dataset.methodId);
                data.methods = ids.map(id => data.methods.find(m => m.id === id));
                saveData();
            }
        });

        c.querySelectorAll('ul').forEach(ul => {
            const s = Sortable.create(ul, {
                animation: 150, handle: '.drag-handle-entry',
                onEnd: () => {
                    const mon2 = monthKey(currentTrackerMonth);
                    [...ul.children].forEach((li, idx) => {
                        if(!li.dataset.entryId) return;
                        const e = data.entries.find(x => x.id === li.dataset.entryId);
                        e.order = e.order || {};
                        e.order[mon2] = idx;
                    });
                    saveData();
                }
            });
            entrySortables.push(s);
        });
    }

    function togglePaid(id) {
        const mon = monthKey(currentTrackerMonth);
        const e = data.entries.find(x => x.id === id);
        e.paid = e.paid || {};
        e.paid[mon] = !e.paid[mon];
        saveData(); // Will trigger view update
    }

    // ==========================================
    // CALENDAR VIEW LOGIC
    // ==========================================
    function initCalendar() {
        const calendarEl = document.getElementById('calendar');
        
        calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            themeSystem: 'standard',
            height: '100%',
            dayMaxEvents: true, // Shows "+2 more" popup instead of stretching rows
            showNonCurrentDates: false,
            fixedWeekCount: false,
            headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek' },
            selectable: true,
            datesSet: (info) => {
                const viewMonth = info.view.currentStart;
                if (monthKey(viewMonth) !== monthKey(currentTrackerMonth)) {
                    currentTrackerMonth = new Date(viewMonth);
                    renderTracker();
                }
            },
            select: (info) => window.openEntryModal(null, info.start),
            eventClick: (info) => window.openEntryModal(info.event.id, info.event.start),
            events: (fetchInfo, successCallback) => {
                const events = [];
                let d = new Date(fetchInfo.start.valueOf());
                const end = new Date(fetchInfo.end.valueOf());
                
                while (d <= end) {
                    const mk = monthKey(d);
                    const activeEntries = data.entries.filter(e => isEntryActiveInMonth(e, mk));
                    
                    activeEntries.forEach(e => {
                        const eventDate = new Date(d.getFullYear(), d.getMonth(), e.dueDay);
                        if (eventDate >= fetchInfo.start && eventDate < fetchInfo.end) {
                            const isPaid = e.paid?.[mk];
                            const now = new Date();
                            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                            const isPast = eventDate < todayStart;
                            const color = isPaid ? '#059669' : (isPast ? '#e11d48' : '#d97706');
                            
                            events.push({
                                id: e.id,
                                title: `${e.item} (RM ${e.amount})`,
                                start: eventDate.toISOString().split('T')[0],
                                allDay: true,
                                backgroundColor: color,
                                borderColor: color,
                                textColor: '#fff'
                            });
                        }
                    });
                    d.setMonth(d.getMonth() + 1);
                    d.setDate(1);
                }
                successCallback(events);
            }
        });
        calendar.render();

        window.addEventListener('resize', () => {
            if (calendar && currentActiveView === 'view-calendar') {
                calendar.updateSize();
            }
        });
    }

    // ==========================================
    // FORECAST VIEW LOGIC
    // ==========================================
    function getForecastSettings() {
        const def = { startingBalance: 0, monthlyIncome: 0, incomeGrowth: 0, expenseInflation: 0, entryEndDates: {}, oneOffEvents: [] };
        const s = localStorage.getItem(SETTINGS_KEY);
        if (s) {
            const p = JSON.parse(s);
            if (!p.entryEndDates || Array.isArray(p.entryEndDates)) p.entryEndDates = {};
            if (!p.oneOffEvents) p.oneOffEvents = [];
            return { ...def, ...p };
        }
        return def;
    }

    function renderForecastScenarios() {
        const settings = getForecastSettings();
        const currentMonthKey = monthKey(new Date());
        
        // Filter entries using new helper
        const activeEntries = data.entries.filter(e => isEntryActiveInMonth(e, currentMonthKey));

        const container = $('expenseScenarios');
        container.innerHTML = '';
        if (!activeEntries.length) {
            container.innerHTML = '<span class="text-muted small">No active expenses.</span>';
            return;
        }

        // Build dropdown options string once
        let cursor = new Date();
        cursor.setDate(1);
        const optionsHTML = ['<option value="">Never Ends</option>'];
        const totalMonths = getForecastTotalMonths();
        for(let i=0; i<totalMonths; i++) {
            const val = monthKey(cursor);
            const text = cursor.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            optionsHTML.push(`<option value="${val}">Stops in ${text}</option>`);
            cursor.setMonth(cursor.getMonth() + 1);
        }
        const selectStr = optionsHTML.join('');

        activeEntries.forEach(e => {
            const div = document.createElement('div');
            div.className = 'scenario-item';
            div.innerHTML = `
                <label class="d-block text-truncate" title="${escapeHTML(e.item)}">${escapeHTML(e.item)} <span class="text-muted fw-normal">(RM ${e.amount})</span></label>
                <select class="form-select form-select-sm" data-entry-id="${e.id}">${selectStr}</select>
            `;
            const sel = div.querySelector('select');
            sel.value = settings.entryEndDates[e.id] || "";
            
            sel.addEventListener('change', (ev) => {
                const s = getForecastSettings();
                if(ev.target.value === "") delete s.entryEndDates[e.id];
                else s.entryEndDates[e.id] = ev.target.value;
                localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
                renderForecast();
            });
            container.appendChild(div);
        });
    }

    function renderForecast() {
        const settings = getForecastSettings();
        let income = settings.monthlyIncome;
        let balance = settings.startingBalance;
        const iGrowth = settings.incomeGrowth || 0;
        const eInflation = settings.expenseInflation || 0;
        const endDates = settings.entryEndDates;
        const oneOffs = settings.oneOffEvents || [];
        const isYearly = $('viewYearly').checked;

        const rawMonthlyData = [];
        let totalIncome = 0;
        let totalExpenses = 0;
        
        const start = new Date();
        let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
        const totalMonths = getForecastTotalMonths();
        
        for (let i = 0; i < totalMonths; i++) {
            if (i > 0 && i % 12 === 0) income *= (1 + (iGrowth / 100));
            
            const mk = monthKey(cursor);
            const mLabel = cursor.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            const yLabel = cursor.getFullYear().toString();
            
            let baseExpense = 0;
            // Native active logic covers both historical and forecasted
            data.entries.forEach(e => {
                if (isEntryActiveInMonth(e, mk)) {
                    // Check user-simulated stop date if it exists
                    const stopDate = endDates[e.id];
                    if (stopDate && mk > stopDate) return; 
                    
                    baseExpense += e.amount;
                }
            });

            const yrs = Math.floor(i / 12);
            let mExp = baseExpense;
            if (yrs > 0) mExp = baseExpense * Math.pow(1 + (eInflation / 100), yrs);

            // Add one-offs
            oneOffs.filter(o => o.monthKey === mk).forEach(o => mExp += o.amount);

            const startBal = balance;
            balance = startBal + income - mExp;
            
            totalIncome += income;
            totalExpenses += mExp;

            rawMonthlyData.push({ monthKey: mk, label: mLabel, yearLabel: yLabel, inc: income, exp: mExp, bal: balance, startBal });
            cursor.setMonth(cursor.getMonth() + 1);
        }

        // Update Insight Cards
        $('insightFinalBalance').textContent = formatCurrency(balance);
        const avgSav = (totalIncome - totalExpenses) / totalMonths;
        $('insightAvgSavings').textContent = formatCurrency(avgSav);
        $('insightAvgSavings').className = `stat-value ${avgSav >= 0 ? 'text-success' : 'text-danger'}`;
        $('insightCashFlow').textContent = `In: ${formatCurrency(totalIncome)} | Out: ${formatCurrency(totalExpenses)}`;
        $('insightCashFlow').style.fontSize = '1.05rem';

        // Process data for chart/table
        const tableBody = $('forecastTableBody');
        tableBody.innerHTML = '';
        const finalLabels = [], finalInc = [], finalExp = [], finalBal = [];

        if (isYearly) {
            $('chartAreaContainer').style.width = '100%';
            
            const yearsMap = new Map();
            rawMonthlyData.forEach(d => {
                if (!yearsMap.has(d.yearLabel)) yearsMap.set(d.yearLabel, []);
                yearsMap.get(d.yearLabel).push(d);
            });
            
            let i = 0;
            for (const [yLabel, chunk] of yearsMap.entries()) {
                const yLabelFormatted = `Year ${i+1} (${yLabel})`;
                const yInc = chunk.reduce((s, d) => s + d.inc, 0);
                const yExp = chunk.reduce((s, d) => s + d.exp, 0);
                const yBal = chunk[chunk.length-1].bal;
                const yStartBal = chunk[0].startBal;

                finalLabels.push(yLabelFormatted); finalInc.push(yInc); finalExp.push(yExp); finalBal.push(yBal);
                
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${yLabelFormatted}</td>
                    <td class="text-end">${formatCurrency(yStartBal)}</td>
                    <td class="text-end text-success">+${formatCurrency(yInc)}</td>
                    <td class="text-end text-danger">-${formatCurrency(yExp)}</td>
                    <td class="text-end fw-bold ${yBal < 0 ? 'text-danger' : 'text-accent'}">${formatCurrency(yBal)}</td>
                `;
                tableBody.appendChild(tr);
                i++;
            }
        } else {
            $('chartAreaContainer').style.width = Math.max(100, rawMonthlyData.length * 5) + '%';
            
            rawMonthlyData.forEach(d => {
                finalLabels.push(d.label); finalInc.push(d.inc); finalExp.push(d.exp); finalBal.push(d.bal);

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${d.label}</td>
                    <td class="text-end">${formatCurrency(d.startBal)}</td>
                    <td class="text-end text-success">${formatCurrency(d.inc)}</td>
                    <td class="text-end text-danger">${formatCurrency(d.exp)}</td>
                    <td class="text-end fw-bold ${d.bal < 0 ? 'text-danger' : 'text-accent'}">${formatCurrency(d.bal)}</td>
                `;
                tableBody.appendChild(tr);
            });
        }

        const ctx = $('forecastChart').getContext('2d');
        if (forecastChart) forecastChart.destroy();
        forecastChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: finalLabels,
                datasets: [
                    { type: 'line', label: 'Rolling Balance', data: finalBal, borderColor: '#eab308', backgroundColor: '#eab308', borderWidth: 3, tension: 0.3, yAxisID: 'yBal', order: 1 },
                    { type: 'bar', label: 'Income', data: finalInc, backgroundColor: 'rgba(34, 197, 94, 0.7)', yAxisID: 'yFlow', order: 2 },
                    { type: 'bar', label: 'Expenses', data: finalExp, backgroundColor: 'rgba(239, 68, 68, 0.7)', yAxisID: 'yFlow', order: 3 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { color: '#f8fafc' } },
                    tooltip: { callbacks: { label: c => `${c.dataset.label}: ${formatCurrency(c.parsed.y)}` } }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#94a3b8' } },
                    yBal: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#eab308', callback: v => 'RM '+v } },
                    yFlow: { type: 'linear', position: 'left', grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', callback: v => 'RM '+v } }
                }
            }
        });
    }

    // ==========================================
    // FORECAST INIT LOGIC
    // ==========================================
    function initForecast() {
        const sm = $('oneOffMonth');
        if (sm) {
            let cursor = new Date();
            cursor.setDate(1);
            const opts = [];
            const totalMonths = getForecastTotalMonths();
            for(let i=0; i<totalMonths; i++) {
                const val = monthKey(cursor);
                const text = cursor.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                opts.push(`<option value="${val}">${text}</option>`);
                cursor.setMonth(cursor.getMonth() + 1);
            }
            sm.innerHTML = opts.join('');
        }

        if ($('oneOffForm')) {
            $('oneOffForm').onsubmit = (e) => {
                e.preventDefault();
                const name = $('oneOffName').value.trim();
                const amt = parseFloat($('oneOffAmount').value);
                const month = $('oneOffMonth').value;
                if (!name || isNaN(amt) || !month) return;
                
                const s = getForecastSettings();
                s.oneOffEvents.push({ id: 'oneoff-' + uuid(), name, amount: amt, monthKey: month });
                localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
                $('oneOffForm').reset();
                renderForecast();
            };
        }
    }

    // ==========================================
    // CATEGORIES VIEW LOGIC
    // ==========================================
    function initCategories() {
        $('addCategoryBtn').onclick = () => {
            $('categoryModalLabel').textContent = 'Add Category';
            $('categoryForm').reset();
            delete $('categoryForm').dataset.editId;
            window.showModal('categoryModal');
        };

        $('categoryForm').onsubmit = (e) => {
            e.preventDefault();
            const name = $('categoryName').value.trim();
            const color = $('categoryColor').value;
            const eid = $('categoryForm').dataset.editId;
            
            if (!name) return;

            if (data.categories.some(c => c.name.toLowerCase() === name.toLowerCase() && c.id !== eid)) {
                return alert('Category already exists');
            }

            if(eid) {
                const c = data.categories.find(x => x.id === eid);
                if (c) {
                    c.name = name;
                    c.color = color;
                }
            } else {
                data.categories.push({ id: 'cat-' + uuid(), name, color });
            }
            saveData();
            window.hideModal('categoryModal');
        };
        
        $('categoryModal').addEventListener('hidden.custom.modal', () => $('categoryForm').reset());
    }

    function renderCategories() {
        const grid = $('categoriesGrid');
        grid.innerHTML = '';
        
        data.categories.forEach(c => {
            const isProtected = c.id === 'cat-misc';
            const col = document.createElement('div');
            
            col.innerHTML = `
                <div class="premium-card h-full p-4 relative" style="border-top: 4px solid ${c.color};">
                    <div class="flex justify-between items-center mb-4">
                        <h5 class="m-0 font-bold truncate" title="${escapeHTML(c.name)}">${escapeHTML(c.name)}</h5>
                        <div class="w-4 h-4 rounded-full flex-shrink-0" style="background-color: ${c.color};"></div>
                    </div>
                    <div class="flex gap-2 mt-auto">
                        <button class="flex-1 bg-white/10 border border-white/10 text-slate-100 hover:bg-white/20 px-3 py-1.5 rounded-lg text-sm font-medium transition-all edit-category">Edit</button>
                        ${!isProtected ? `<button class="bg-white/10 border border-white/10 text-red-400 hover:bg-red-500 hover:text-white px-3 py-1.5 rounded-lg transition-all delete-category"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}
                    </div>
                </div>
            `;
            
            col.querySelector('.edit-category').onclick = () => {
                $('categoryModalLabel').textContent = 'Edit Category';
                $('categoryName').value = c.name;
                $('categoryColor').value = c.color;
                $('categoryForm').dataset.editId = c.id;
                window.showModal('categoryModal');
            };
            
            if (!isProtected) {
                col.querySelector('.delete-category').onclick = () => {
                    if (confirm(`Delete "${c.name}"? Existing expenses will be reassigned to "Misc".`)) {
                        data.categories = data.categories.filter(x => x.id !== c.id);
                        // Reassign logic
                        data.entries.forEach(e => {
                            if (e.category === c.id) e.category = 'cat-misc';
                        });
                        saveData();
                    }
                };
            }
            
            grid.appendChild(col);
        });
    }

    // ==========================================
    // METHODS VIEW LOGIC
    // ==========================================
    function initMethods() {
        $('addMethodBtn').onclick = () => {
            $('methodModalLabel').textContent = 'Add Method';
            $('methodForm').reset();
            delete $('methodForm').dataset.editId;
            window.showModal('methodModal');
        };

        $('methodForm').onsubmit = (e) => {
            e.preventDefault();
            const mon = monthKey(currentTrackerMonth); // Still use current tracker month as the pivot for names
            const name = $('methodName').value.trim();
            const color = $('methodColor').value;
            const eid = $('methodForm').dataset.editId;
            
            if (!name) return;

            if (data.methods.some(m => getMethodName(m, mon).toLowerCase() === name.toLowerCase() && m.id !== eid)) {
                return alert('Payment method already exists');
            }

            if(eid) {
                const m = data.methods.find(x => x.id === eid);
                if (m) {
                    m.names = m.names || {};
                    m.names[mon] = name;
                    m.color = color;
                }
            } else {
                data.methods.push({ 
                    id: 'method-' + uuid(), 
                    name, 
                    names: { [mon]: name },
                    color: color 
                });
            }
            saveData();
            window.hideModal('methodModal');
        };
        
        $('methodModal').addEventListener('hidden.custom.modal', () => $('methodForm').reset());
    }

    function renderMethods() {
        const grid = $('methodsGrid');
        grid.innerHTML = '';
        const mon = monthKey(currentTrackerMonth);
        
        if (!data.methods.length) {
            grid.innerHTML = `<div class="col-span-full bg-slate-800 border border-white/10 rounded-xl p-6 text-center text-slate-400 py-12"><i data-lucide="credit-card" class="w-12 h-12 mx-auto mb-4 opacity-50"></i>No payment methods yet.<br>Click <strong>Add Method</strong> to create one.</div>`;
            return;
        }
        
        data.methods.forEach(m => {
            const isProtected = m.id === 'method-cash';
            const mName = getMethodName(m, mon);
            const col = document.createElement('div');
            
            col.innerHTML = `
                <div class="premium-card h-full p-4 relative" style="border-top: 4px solid ${m.color};">
                    <div class="flex justify-between items-center mb-4">
                        <h5 class="m-0 font-bold truncate" title="${escapeHTML(mName)}">${escapeHTML(mName)}</h5>
                        <div class="w-4 h-4 rounded-full flex-shrink-0" style="background-color: ${m.color};"></div>
                    </div>
                    <div class="flex gap-2 mt-auto">
                        <button class="flex-1 bg-white/10 border border-white/10 text-slate-100 hover:bg-white/20 px-3 py-1.5 rounded-lg text-sm font-medium transition-all edit-method">Edit</button>
                        ${!isProtected ? `<button class="bg-white/10 border border-white/10 text-red-400 hover:bg-red-500 hover:text-white px-3 py-1.5 rounded-lg transition-all delete-method"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}
                    </div>
                </div>
            `;
            
            col.querySelector('.edit-method').onclick = () => {
                $('methodModalLabel').textContent = 'Edit Method';
                $('methodName').value = mName;
                $('methodColor').value = m.color;
                $('methodForm').dataset.editId = m.id;
                window.showModal('methodModal');
            };
            
            if (!isProtected) {
                col.querySelector('.delete-method').onclick = () => {
                    if (confirm(`Delete "${mName}"? Existing expenses will be reassigned to "Cash".`)) {
                        data.methods = data.methods.filter(x => x.id !== m.id);
                        // Reassign logic
                        data.entries.forEach(e => {
                            if (e.method === m.id) e.method = 'method-cash';
                            if (e.assignments) {
                                Object.keys(e.assignments).forEach(k => {
                                    if (e.assignments[k] === m.id) {
                                        e.assignments[k] = 'method-cash';
                                    }
                                });
                            }
                        });
                        saveData();
                    }
                };
            }
            
            grid.appendChild(col);
        });
    }

    // ==========================================
    // MODALS (ENTRY CRUD)
    // ==========================================

    // Entry
    let currentEditEntryId = null;
    window.openEntryModal = (id = null, defaultDate = null) => {
        currentEditEntryId = id;
        const targetDate = defaultDate || currentTrackerMonth;
        const mon = monthKey(targetDate);
        const methodSelect = $('entryMethod');
        methodSelect.innerHTML = data.methods.map(m => `<option value="${m.id}">${escapeHTML(getMethodName(m, mon))}</option>`).join('');
        
        const catSelect = $('entryCategory');
        catSelect.innerHTML = data.categories.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');

        const isEdit = Boolean(id);
        $('entryModalLabel').textContent = isEdit ? 'Edit Entry' : 'Add Entry';
        
        $('deleteEntryBtn').classList.add('hidden');
        $('disableEntryBtn').classList.add('hidden');
        $('togglePaidBtn').classList.add('hidden');

        if (isEdit) {
            const ent = data.entries.find(e => e.id === id);
            if (ent) {
                $('entryItem').value = ent.item;
                $('entryAmount').value = ent.amount;
                $('entryDueDay').value = ent.dueDay || ent.due;
                $('entryType').value = ent.type || 'recurring';
                $('entryCategory').value = ent.category || 'cat-misc';
                $('entryStart').value = ent.startMonth || mon;
                $('entryEnd').value = ent.endMonth || '';
                methodSelect.value = getAssignment(ent, mon) || (data.methods[0] ? data.methods[0].id : '');
                
                if (ent.type === 'one-off') {
                    $('endMonthContainer').classList.add('hidden');
                    $('startMonthLabel').innerText = 'Month';
                } else {
                    $('endMonthContainer').classList.remove('hidden');
                    $('startMonthLabel').innerText = 'Start Month';
                }

                $('deleteEntryBtn').classList.remove('hidden');
                $('deleteEntryBtn').onclick = () => {
                    if(confirm('Permanently delete this entry from all history?')) {
                        data.entries = data.entries.filter(e => e.id !== id);
                        saveData();
                        triggerViewUpdate();
                        window.hideModal('entryModal');
                    }
                };
                
                if (ent.type === 'recurring') {
                    $('disableEntryBtn').classList.remove('hidden');
                    const isDisabled = getAssignment(ent, mon) === 'DELETED';
                    $('disableEntryBtn').innerText = isDisabled ? 'Enable' : 'Disable';
                    $('disableEntryBtn').onclick = () => {
                        ent.assignments[mon] = isDisabled ? methodSelect.value : 'DELETED';
                        saveData();
                        triggerViewUpdate();
                        window.hideModal('entryModal');
                    };
                }

                $('togglePaidBtn').classList.remove('hidden');
                const isPaid = ent.paid?.[mon];
                $('togglePaidBtn').innerText = isPaid ? 'Mark Unpaid' : 'Mark Paid';
                $('togglePaidBtn').onclick = () => {
                    ent.paid = ent.paid || {};
                    ent.paid[mon] = !isPaid;
                    saveData();
                    triggerViewUpdate();
                    window.hideModal('entryModal');
                };
            }
        } else {
            $('entryForm').reset();
            if(defaultDate) {
                $('entryDueDay').value = defaultDate.getDate();
            }
            $('entryStart').value = mon;
            $('entryType').value = 'recurring';
            $('endMonthContainer').classList.remove('hidden');
            $('startMonthLabel').innerText = 'Start Month';
            if(data.methods.length) methodSelect.value = data.methods[0].id;
        }
        window.showModal('entryModal');
    };

    $('addEntryBtn').onclick = () => window.openEntryModal();

    $('entryType').addEventListener('change', (e) => {
        if (e.target.value === 'one-off') {
            $('endMonthContainer').classList.add('hidden');
            $('startMonthLabel').innerText = 'Month';
        } else {
            $('endMonthContainer').classList.remove('hidden');
            $('startMonthLabel').innerText = 'Start Month';
        }
    });

    $('entryForm').onsubmit = (e) => {
        e.preventDefault();
        const mon = monthKey(currentTrackerMonth);
        const item = $('entryItem').value.trim();
        const amount = parseFloat($('entryAmount').value);
        const methodId = $('entryMethod').value;
        const dueDay = parseInt($('entryDueDay').value);
        
        const type = $('entryType').value;
        const category = $('entryCategory').value;
        const startMonth = $('entryStart').value;
        const endMonth = $('entryEnd').value || undefined;

        if (currentEditEntryId) {
            const ent = data.entries.find(x => x.id === currentEditEntryId);
            const prevAssigned = getAssignment(ent, mon);
            
            ent.item = item;
            ent.amount = amount;
            ent.dueDay = dueDay;
            ent.due = dueDay; // backwards compatibility
            ent.type = type;
            ent.category = category;
            ent.startMonth = startMonth;
            ent.endMonth = endMonth;

            if (prevAssigned !== methodId && prevAssigned !== 'DELETED') {
                ent.assignments = ent.assignments || {};
                ent.assignments[mon] = methodId;
            }
        } else {
            data.entries.push({ 
                id: uuid(), item, amount, dueDay, due: dueDay, 
                assignments: { [startMonth]: methodId }, 
                paid: {}, order: {}, 
                type, category, startMonth, endMonth 
            });
        }
        
        saveData();
        triggerViewUpdate();
        window.hideModal('entryModal');
    };
    // Cleanup on hide
    $('entryModal').addEventListener('hidden.custom.modal', () => $('entryForm').reset());
    $('methodModal').addEventListener('hidden.custom.modal', () => $('methodName').value = '');
    // Export / Import
    if ($('exportBtn')) {
        $('exportBtn').onclick = () => {
            const exportData = { ...data, forecastSettings: getForecastSettings() };
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' }));
            a.download = `paytrack-backup-${monthKey(new Date())}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        };
    }
    if ($('importBtn')) {
        $('importBtn').onclick = () => $('importFileInput').click();
    }
    if ($('importFileInput')) {
        $('importFileInput').onchange = (e) => {
            const f = e.target.files[0];
            if(!f) return;
            const r = new FileReader();
            r.onload = () => {
                try {
                    const imp = JSON.parse(r.result);
                    if (imp.items && !imp.entries) { imp.entries = imp.items; delete imp.items; }
                    if (imp.payments && !imp.methods) { imp.methods = imp.payments; delete imp.payments; }
                    if (!imp || !Array.isArray(imp.methods) || !Array.isArray(imp.entries)) throw new Error('Invalid format');
                    if (!Array.isArray(imp.categories)) imp.categories = [];
                    if (confirm('Overwrite current data?')) { 
                        if (imp.forecastSettings) {
                            localStorage.setItem(SETTINGS_KEY, JSON.stringify(imp.forecastSettings));
                            delete imp.forecastSettings;
                        }
                        data = imp; 
                        saveData(); 
                        alert('Imported successfully.');
                        triggerViewUpdate();
                    }
                } catch (err) { alert('Import failed: ' + err.message); }
            };
            r.readAsText(f);
            e.target.value = '';
        };
    }
    
    // Clear Data
    if ($('resetDataBtn')) {
        $('resetDataBtn').onclick = () => window.showModal('clearDataModal');
    }
    if ($('confirmResetBtn')) {
        $('confirmResetBtn').onclick = () => {
            localStorage.removeItem(STORAGE_KEY);
            data = {
                methods: [],
                categories: [
                    { id: 'cat-housing', name: 'Housing', color: '#60a5fa' },
                    { id: 'cat-utilities', name: 'Utilities', color: '#facc15' },
                    { id: 'cat-subscriptions', name: 'Subscriptions', color: '#c084fc' },
                    { id: 'cat-food', name: 'Food & Dining', color: '#4ade80' },
                    { id: 'cat-transport', name: 'Transportation', color: '#fb923c' },
                    { id: 'cat-debt', name: 'Debt / Loans', color: '#f87171' },
                    { id: 'cat-personal', name: 'Personal Care', color: '#38bdf8' },
                    { id: 'cat-entertainment', name: 'Entertainment', color: '#818cf8' },
                    { id: 'cat-savings', name: 'Savings / Investments', color: '#34d399' },
                    { id: 'cat-shopping', name: 'Shopping', color: '#ec4899' },
                    { id: 'cat-health', name: 'Health & Medical', color: '#f43f5e' },
                    { id: 'cat-education', name: 'Education', color: '#a855f7' },
                    { id: 'cat-family', name: 'Family / Kids', color: '#14b8a6' },
                    { id: 'cat-insurance', name: 'Insurance', color: '#0ea5e9' },
                    { id: 'cat-misc', name: 'Misc', color: '#9ca3af' }
                ],
                entries: [],
                settings: {
                    paycheckDay: 25,
                    currency: 'RM'
                }
            };
            saveData();
            window.hideModal('clearDataModal');
            alert('All data has been cleared.');
        };
    }
})();
