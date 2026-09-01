// app.js
(() => {
    // ==========================================
    // CORE STATE & UTILS
    // ==========================================
    const $ = id => document.getElementById(id);
    const STORAGE_KEY_PREFIX = 'paytrack_data_';
    const PROFILES_KEY = 'paytrack_profiles';
    const ACTIVE_PROFILE_KEY = 'paytrack_active_profile';
    const CATEGORIES_KEY = 'paytrack_global_categories';
    function getSettingsKey(pid) { return 'paytrack_forecast_settings_' + (pid || activeProfileId); }

    // Global App State
    let profiles = [];
    let activeProfileId = 'default';
    
    let data = { methods: [], entries: [], categories: [] };
    let currentTrackerMonth = new Date();
    currentTrackerMonth.setDate(1);
    let currentActiveView = 'view-dashboard';
    
    // Vendor Instances
    let methodSortable = null;
    let entrySortables = [];
    let calendar = null;
    let calendarExpenseType = 'Both';
    let forecastChart = null;
    let categoryChart = null, methodChart = null, trendChart = null;
    let dashMacroChartInstance = null;
    let dashCategoryChartInstance = null;
    let activeModal = null; // Currently open bootstrap modal
    let currentAnalyticsDate = new Date();
    currentAnalyticsDate.setDate(1);
    let currentBudgetDate = new Date();
    currentBudgetDate.setDate(1);
    let currentDailyDate = new Date();

    const formatCurrency = (val) => new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(val);
    const escapeHTML = (str) => String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag]));
    
    const uuid = () => {
        if (crypto.randomUUID) return crypto.randomUUID();
        const b = crypto.getRandomValues(new Uint8Array(16));
        b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
        return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    };

    const monthKey = date => `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const refreshIcons = (root) => {
        if (window.lucide) {
            window.lucide.createIcons(root ? { root } : undefined);
        }
    };
    
    function safeJSONParse(str, fallback) {
        if (!str || str === 'null' || str === 'undefined') return fallback;
        try {
            const parsed = JSON.parse(str);
            if (parsed === null || typeof parsed !== 'object') return fallback;
            // Structural validation for primary app data
            if (fallback && typeof fallback === 'object' && 'entries' in fallback) {
                if (!Array.isArray(parsed.entries)) parsed.entries = [];
                if (!Array.isArray(parsed.methods)) parsed.methods = [];
                if (!Array.isArray(parsed.categories)) parsed.categories = [];
                if (!Array.isArray(parsed.goals)) parsed.goals = [];
            }
            return parsed;
        } catch (e) {
            console.error('Failed to parse JSON from storage:', e);
            return fallback;
        }
    }

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
        
        const parseMk = (str) => {
            const [y, m] = str.split('-').map(Number);
            return y * 12 + m;
        };
        
        const currentTotal = parseMk(mk);
        
        if (entry.startMonth) {
            const startTotal = parseMk(entry.startMonth);
            if (currentTotal < startTotal) return false;
        }
        
        if (entry.type === 'one-off') {
            return mk === entry.startMonth;
        } else {
            if (entry.endMonth) {
                const endTotal = parseMk(entry.endMonth);
                if (currentTotal > endTotal) return false;
            }
            return true;
        }
    }

    function loadData() {
        // Load global categories
        const catStr = localStorage.getItem(CATEGORIES_KEY);
        let globalCategories = safeJSONParse(catStr, []);

        const profStr = localStorage.getItem(PROFILES_KEY);
        profiles = safeJSONParse(profStr, []);

        activeProfileId = localStorage.getItem(ACTIVE_PROFILE_KEY);
        if (!activeProfileId) {
            if (profiles.length > 0) {
                activeProfileId = profiles[0].id;
                localStorage.setItem(ACTIVE_PROFILE_KEY, activeProfileId);
            } else {
                activeProfileId = 'default';
                profiles = [{ id: 'default', name: 'Default Profile' }];
                localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
                localStorage.setItem(ACTIVE_PROFILE_KEY, activeProfileId);
            }
        }
        
        const s = localStorage.getItem(STORAGE_KEY_PREFIX + activeProfileId);
        if (s) {
            data = safeJSONParse(s, { methods: [], entries: [], categories: [], goals: [] });
            if (!data.goals) data.goals = [];
        } else {
            const legacy = localStorage.getItem('paytrack_data');
            if (legacy) {
                data = safeJSONParse(legacy, { methods: [], entries: [], categories: [], goals: [] });
                if (!data.goals) data.goals = [];
                saveData();
                localStorage.removeItem('paytrack_data');
            } else {
                data = { methods: [], entries: [], categories: [], goals: [] };
            }
        }
        
        // Data Migration & Backwards Compatibility (V1 -> V2)
        if (data) {
            if (!data.goals) data.goals = [];
            if (data.entries) {
            const currentMonthStr = monthKey(new Date());
            let requiresSave = false;
            
            data.entries.forEach(e => {
                if (!e.type) { e.type = 'recurring'; requiresSave = true; }
                if (!e.category) { e.category = 'cat-misc'; requiresSave = true; }
                if (!e.startMonth) { e.startMonth = currentMonthStr; requiresSave = true; }
                if (!e.paid) { e.paid = {}; requiresSave = true; }
                if (!e.order) { e.order = {}; requiresSave = true; }
                
                // Migrate V1 flat methodId to V2 assignments timeline
                if (e.methodId && !e.assignments) {
                    e.assignments = { [e.startMonth]: e.methodId };
                    delete e.methodId;
                    requiresSave = true;
                } else if (!e.assignments) {
                    e.assignments = {};
                    requiresSave = true;
                }
            });
            
            if (requiresSave) {
                localStorage.setItem(STORAGE_KEY_PREFIX + activeProfileId, JSON.stringify({ methods: data.methods, entries: data.entries, goals: data.goals || [] }));
            }
        }
    }
        
        // Inject global categories into data object for compatibility
        data.categories = globalCategories;

        // Initialize default categories if missing globally
        if (!data.categories || !data.categories.length) {
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
            e.amount = Number(e.amount) || 0;
            if (e.dueDay) e.dueDay = parseInt(e.dueDay) || 1;
            if (!e.category) e.category = 'cat-misc';
            // Migrate legacy category strings to IDs if needed
            if (e.category && !e.category.startsWith('cat-')) {
                const mapped = data.categories.find(c => c.name.toLowerCase() === e.category.toLowerCase());
                e.category = mapped ? mapped.id : 'cat-misc';
            }
            if (!e.type) e.type = 'recurring';
            if (!e.startMonth) e.startMonth = '2024-01';
        });

        // Migrate Goals to dynamic calculation
        if (data.goals) {
            data.goals.forEach(g => {
                if (g.currentAmount !== undefined) {
                    if (g.currentAmount > 0) {
                        const curMonth = monthKey(new Date());
                        data.entries.push({
                            id: 'entry-' + Date.now() + Math.random().toString(36).substr(2, 5),
                            item: `Initial Savings: ${g.name}`,
                            amount: g.currentAmount,
                            dueDay: new Date().getDate(),
                            due: new Date().getDate(),
                            assignments: { [curMonth]: data.methods.length ? data.methods[0].id : 'method-cash' },
                            paid: { [curMonth]: true },
                            order: {},
                            type: 'one-off',
                            category: 'cat-savings',
                            startMonth: curMonth,
                            endMonth: curMonth,
                            isDaily: true,
                            goalId: g.id
                        });
                    }
                    delete g.currentAmount;
                }
            });
        }
    }
    function saveData() {
        localStorage.setItem(CATEGORIES_KEY, JSON.stringify(data.categories));
        
        const storageKey = STORAGE_KEY_PREFIX + activeProfileId;
        const dataToSave = { methods: data.methods, entries: data.entries, goals: data.goals || [] };
        localStorage.setItem(storageKey, JSON.stringify(dataToSave));
        triggerViewUpdate();
    }

    // ==========================================
    // BUDGETS VIEW
    // ==========================================
    function renderBudgets() {
        const mk = monthKey(currentBudgetDate);
        $('budgetDisplayDate').textContent = currentBudgetDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        
        const activeEntries = data.entries.filter(e => isEntryActiveInMonth(e, mk));
        const list = $('budgetsList');
        list.innerHTML = '';

        data.categories.forEach(cat => {
            if (cat.id === 'cat-savings') return;

            let catBudget = (cat.budgetOverrides && cat.budgetOverrides[mk]) !== undefined ? cat.budgetOverrides[mk] : (cat.budget || 0);
            let hasOverride = (cat.budgetOverrides && cat.budgetOverrides[mk] !== undefined);
            
            let catSpent = 0;
            activeEntries.forEach(e => {
                if (e.category === cat.id) catSpent += e.amount;
            });

            const hasBudget = catBudget > 0;
            const pct = hasBudget ? (catSpent / catBudget) * 100 : 0;
            const clampedPct = Math.min(pct, 100);
            
            let statusColor = 'text-slate-400';
            let barColor = 'bg-slate-600';
            let pulseClass = '';

            if (hasBudget) {
                if (pct >= 100) {
                    statusColor = 'text-rose-400';
                    barColor = 'bg-rose-500';
                    pulseClass = 'animate-pulse';
                } else if (pct >= 80) {
                    statusColor = 'text-amber-400';
                    barColor = 'bg-amber-400';
                } else {
                    statusColor = 'text-emerald-400';
                    barColor = 'bg-emerald-500';
                }
            }

            const card = document.createElement('div');
            card.className = `premium-card flex flex-col justify-between ${hasBudget && pct >= 100 ? 'border-rose-500/30' : ''}`;
            card.innerHTML = `
                <div>
                    <div class="flex justify-between items-start mb-4">
                        <div class="flex items-center gap-2">
                            <div class="w-3 h-3 rounded-full" style="background-color: ${cat.color}"></div>
                            <h4 class="font-bold text-slate-100">${escapeHTML(cat.name)}</h4>
                            ${hasOverride ? `<span class="bg-indigo-500/20 text-indigo-300 text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider" title="Month specific override">Override</span>` : ''}
                        </div>
                        <button class="text-slate-400 hover:text-white transition-colors" onclick="openBudgetModal('${cat.id}')">
                            <i data-lucide="edit-2" class="w-4 h-4"></i>
                        </button>
                    </div>
                    
                    ${hasBudget ? `
                        <div class="flex justify-between items-end mb-2">
                            <span class="text-2xl font-bold text-white">${formatCurrency(catSpent)}</span>
                            <div class="text-right">
                                <span class="text-sm ${statusColor} font-bold">${Math.round(pct)}%</span>
                                <span class="block text-xs text-slate-400">of ${formatCurrency(catBudget)}</span>
                            </div>
                        </div>
                        <div class="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                            <div class="${barColor} ${pulseClass} h-full transition-all duration-500" style="width: ${clampedPct}%"></div>
                        </div>
                        ${pct >= 100 ? `<p class="text-xs text-rose-400 mt-2 flex items-center gap-1"><i data-lucide="alert-triangle" class="w-3 h-3"></i> Over budget by ${formatCurrency(catSpent - catBudget)}</p>` : ''}
                    ` : `
                        <div class="flex flex-col items-center justify-center py-4 opacity-50">
                            <span class="text-sm text-slate-400 mb-2">No budget set</span>
                            <button class="text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-colors" onclick="openBudgetModal('${cat.id}')">Set Limit</button>
                        </div>
                    `}
                </div>
            `;
            list.appendChild(card);
        });
        
        refreshIcons();
    }

    // ==========================================
    // ANALYTICS VIEW
    // ==========================================
    function initAnalytics() {
        $('prevAnalyticsMonth').onclick = () => { currentAnalyticsDate.setMonth(currentAnalyticsDate.getMonth() - 1); renderAnalytics(); };
        $('nextAnalyticsMonth').onclick = () => { currentAnalyticsDate.setMonth(currentAnalyticsDate.getMonth() + 1); renderAnalytics(); };
        $('resetAnalyticsMonth').onclick = () => { currentAnalyticsDate = new Date(); currentAnalyticsDate.setDate(1); renderAnalytics(); };
    }
    
    // Budgets UI binding
    window.changeBudgetDate = (delta) => {
        currentBudgetDate.setMonth(currentBudgetDate.getMonth() + delta);
        renderBudgets();
    };
    function renderDashboard() {
        const activeProfile = profiles.find(p => p.id === activeProfileId);
        $('dashboardGreeting').textContent = `Welcome back, ${activeProfile ? activeProfile.name : 'User'}!`;
        
        const now = new Date();
        const mk = monthKey(now);
        const day = now.getDate();
        const activeEntries = data.entries.filter(e => isEntryActiveInMonth(e, mk));
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        
        // Today's Glance
        const todayEntries = activeEntries.filter(e => Math.min(e.dueDay, daysInMonth) === day);
        const todayList = $('dashboardTodayList');
        if (todayEntries.length === 0) {
            todayList.innerHTML = `<div class="flex-grow flex flex-col items-center justify-center text-center text-slate-400 py-6">
                <i data-lucide="sun" class="w-10 h-10 mb-3 opacity-30 text-yellow-500"></i>
                <p class="text-sm">Nothing due today!<br>Enjoy your day.</p>
            </div>`;
        } else {
            let listHtml = '';
            todayEntries.slice(0, 4).forEach(e => {
                const isPaid = e.paid && e.paid[mk];
                listHtml += `<div class="flex justify-between items-center bg-black/20 p-3 rounded-lg border border-white/5">
                    <div class="flex items-center gap-3">
                        <div class="w-2 h-2 rounded-full ${isPaid ? 'bg-success' : 'bg-warning'}"></div>
                        <span class="text-sm font-medium ${isPaid ? 'line-through text-slate-500' : 'text-slate-200'} truncate max-w-[120px]">${escapeHTML(e.item)}</span>
                    </div>
                    <span class="text-sm font-bold ${isPaid ? 'text-slate-500' : ''}">RM ${e.amount.toFixed(2)}</span>
                </div>`;
            });
            if (todayEntries.length > 4) {
                listHtml += `<div class="text-center mt-2"><span class="text-xs text-indigo-400 font-medium">+ ${todayEntries.length - 4} more items</span></div>`;
            }
            todayList.innerHTML = listHtml;
        }

        // Month Snapshot
        let currentMonthExpenses = 0;
        let currentMonthSavings = 0;
        activeEntries.forEach(e => {
            if (e.category === 'cat-savings') currentMonthSavings += e.amount;
            else currentMonthExpenses += e.amount;
        });
        const monthlyIncome = getForecastSettings().monthlyIncome || 0;
        const totalOut = currentMonthExpenses + currentMonthSavings;
        const maxVal = Math.max(monthlyIncome, totalOut);
        
        let incPct = 0, expPct = 0, savPct = 0;
        if (maxVal > 0) {
            incPct = (monthlyIncome / maxVal) * 100;
            expPct = (currentMonthExpenses / maxVal) * 100;
            savPct = (currentMonthSavings / maxVal) * 100;
        }
        
        const netCashFlow = monthlyIncome - totalOut;
        $('dashTotalIncome').textContent = 'RM ' + monthlyIncome.toFixed(2);
        $('dashTotalOut').textContent = 'RM ' + totalOut.toFixed(2);
        const dashNcf = $('dashNetCashFlow');
        dashNcf.textContent = (netCashFlow >= 0 ? '' : '-') + 'RM ' + Math.abs(netCashFlow).toFixed(2);
        dashNcf.className = 'text-sm font-bold ' + (netCashFlow >= 0 ? 'text-success' : 'text-danger');
        
        $('dashIncomeBar').style.width = incPct + '%';
        $('dashExpenseBar').style.width = expPct + '%';
        $('dashSavingsBar').style.width = savPct + '%';

        // Nearest Goal
        const nearestGoalContainer = $('dashboardNearestGoal');
        if (!data.goals || data.goals.length === 0) {
            nearestGoalContainer.innerHTML = `<div class="flex-grow flex flex-col items-center justify-center text-slate-400 py-6">
                <i data-lucide="target" class="w-10 h-10 mb-3 opacity-30 text-emerald-500"></i>
                <p class="text-sm">No active goals.<br>Set one up to track your savings!</p>
            </div>`;
        } else {
            let sortedGoals = [...data.goals].sort((a, b) => {
                const aVal = getGoalCurrentAmount(a.id);
                const bVal = getGoalCurrentAmount(b.id);
                const aPct = a.targetAmount > 0 ? aVal / a.targetAmount : 0;
                const bPct = b.targetAmount > 0 ? bVal / b.targetAmount : 0;
                return bPct - aPct; // Sort by closest to completion
            });
            const topGoal = sortedGoals[0];
            const currentAmt = getGoalCurrentAmount(topGoal.id);
            const pct = Math.min(100, topGoal.targetAmount > 0 ? (currentAmt / topGoal.targetAmount) * 100 : 0);
            
            nearestGoalContainer.innerHTML = `
                <div class="relative inline-flex items-center justify-center mx-auto mb-4 mt-2">
                    <svg class="w-32 h-32 transform -rotate-90">
                        <circle class="text-slate-800" stroke-width="8" stroke="currentColor" fill="transparent" r="56" cx="64" cy="64"/>
                        <circle class="text-emerald-500 transition-all duration-1000 ease-out" stroke-width="8" stroke-dasharray="351.86" stroke-dashoffset="${351.86 - (pct / 100) * 351.86}" stroke-linecap="round" stroke="currentColor" fill="transparent" r="56" cx="64" cy="64"/>
                    </svg>
                    <div class="absolute flex flex-col items-center justify-center text-center">
                        <span class="text-2xl font-bold">${Math.round(pct)}%</span>
                    </div>
                </div>
                <h6 class="font-bold text-lg m-0 truncate px-2">${escapeHTML(topGoal.name)}</h6>
                <p class="text-sm text-slate-400 m-0">RM ${currentAmt.toLocaleString()} / RM ${topGoal.targetAmount.toLocaleString()}</p>
            `;
        }

        // --- DASHBOARD BUDGET WIDGET ---
        renderDashboardBudgets();
        
        // ============================
        // ROW 1: MONTHLY SNAPSHOT
        // ============================
        try {
            if (window.Chart) {
                const macroLabels = [];
                const macroIncomeData = [];
                const macroOutgoingsData = [];
                
                const tempD = new Date(now.getFullYear(), now.getMonth() - 5, 1);
                for (let i = 0; i < 6; i++) {
                    const tempMk = monthKey(tempD);
                    macroLabels.push(tempD.toLocaleDateString('en-US', { month: 'short' }));
                    
                    let tempExp = 0, tempSav = 0;
                    data.entries.filter(e => isEntryActiveInMonth(e, tempMk)).forEach(e => {
                        if (e.category === 'cat-savings') tempSav += e.amount;
                        else tempExp += e.amount;
                    });
                    macroOutgoingsData.push(tempExp + tempSav);
                    macroIncomeData.push(monthlyIncome);
                    tempD.setMonth(tempD.getMonth() + 1);
                }

                const ctxMacro = $('dashMacroChart').getContext('2d');
                if (dashMacroChartInstance) dashMacroChartInstance.destroy();
                dashMacroChartInstance = new Chart(ctxMacro, {
                    type: 'bar',
                    data: {
                        labels: macroLabels,
                        datasets: [
                            {
                                type: 'line',
                                label: 'Income',
                                data: macroIncomeData,
                                borderColor: '#10b981',
                                borderWidth: 2,
                                fill: false,
                                tension: 0.4
                            },
                            {
                                type: 'bar',
                                label: 'Total Outgoings',
                                data: macroOutgoingsData,
                                backgroundColor: '#ef4444',
                                borderRadius: 4
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { labels: { color: '#94a3b8' } } },
                        scales: {
                            x: { ticks: { color: '#64748b' }, grid: { color: '#ffffff10' } },
                            y: { ticks: { color: '#64748b' }, grid: { color: '#ffffff10' }, beginAtZero: true }
                        }
                    }
                });
            }
        } catch (err) {
            console.error("Macro Chart Error: ", err);
        }

        // ============================
        // ROW 3: RECENT ACTIVITY
        // ============================
        try {
            const recentList = $('dashRecentActivity');
            const prevMk = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
            
            let allRecent = [];
            data.entries.forEach(e => {
                if (e.isDaily) {
                    if (e.startMonth === mk || e.startMonth === prevMk) {
                        const dDay = e.dueDay ? String(e.dueDay).padStart(2, '0') : '01';
                        const dt = new Date(e.startMonth + '-' + dDay);
                        allRecent.push({ ...e, actualDate: dt });
                    }
                } else {
                    if (isEntryActiveInMonth(e, mk) && e.paid && e.paid[mk]) {
                        const dDay = e.dueDay ? String(e.dueDay).padStart(2, '0') : '01';
                        const dt = new Date(mk + '-' + dDay);
                        allRecent.push({ ...e, actualDate: dt });
                    }
                    if (isEntryActiveInMonth(e, prevMk) && e.paid && e.paid[prevMk]) {
                        const dDay = e.dueDay ? String(e.dueDay).padStart(2, '0') : '01';
                        const dt = new Date(prevMk + '-' + dDay);
                        allRecent.push({ ...e, actualDate: dt });
                    }
                }
            });
            
            allRecent.sort((a, b) => b.actualDate - a.actualDate);
            
            if (allRecent.length === 0) {
                recentList.innerHTML = `<div class="flex-grow flex flex-col items-center justify-center text-slate-400 py-6">
                    <i data-lucide="activity" class="w-10 h-10 mb-3 opacity-30 text-rose-400"></i>
                    <p class="text-sm">No recent activity.</p>
                </div>`;
            } else {
                recentList.innerHTML = allRecent.slice(0, 10).map(e => {
                    const catObj = data.categories.find(c => c.id === e.category) || { name: 'Misc', color: '#9ca3af' };
                    const dateStr = e.actualDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    return `
                    <div class="flex justify-between items-center bg-black/20 p-3 rounded-lg border border-white/5">
                        <div class="flex items-center gap-3">
                            <div class="w-3 h-3 rounded-full" style="background-color: ${catObj.color}"></div>
                            <div>
                                <div class="text-sm font-medium text-slate-200 truncate max-w-[150px] md:max-w-[200px]">${escapeHTML(e.item)}</div>
                                <div class="text-xs text-slate-400">${dateStr} &bull; ${escapeHTML(catObj.name)}</div>
                            </div>
                        </div>
                        <span class="text-sm font-bold text-slate-200">RM ${e.amount.toFixed(2)}</span>
                    </div>`;
                }).join('');
            }
        } catch (err) {
            console.error("Recent Activity Error: ", err);
        }

        // ============================
        // ROW 3: CATEGORY PIE CHART
        // ============================
        try {
            if (window.Chart) {
                const catMap = {};
                let hasAnyCatExpense = false;
                activeEntries.forEach(e => {
                    if (e.category === 'cat-savings') return;
                    hasAnyCatExpense = true;
                    if (!catMap[e.category]) catMap[e.category] = 0;
                    catMap[e.category] += e.amount;
                });

                const ctxDashCat = $('dashCategoryChart').getContext('2d');
                if (dashCategoryChartInstance) dashCategoryChartInstance.destroy();

                if (!hasAnyCatExpense) {
                    $('dashCategoryChart').style.display = 'none';
                    $('dashCategoryEmpty').classList.remove('hidden');
                    $('dashCategoryEmpty').classList.add('flex');
                } else {
                    $('dashCategoryChart').style.display = 'block';
                    $('dashCategoryEmpty').classList.add('hidden');
                    $('dashCategoryEmpty').classList.remove('flex');
                    
                    const catLabels = [];
                    const catData = [];
                    const catColors = [];
                    
                    Object.keys(catMap).sort((a,b) => catMap[b] - catMap[a]).forEach(catId => {
                        const cObj = data.categories.find(c => c.id === catId) || { name: 'Misc', color: '#9ca3af' };
                        catLabels.push(cObj.name);
                        catColors.push(cObj.color);
                        catData.push(catMap[catId]);
                    });
                    
                    dashCategoryChartInstance = new Chart(ctxDashCat, {
                        type: 'doughnut',
                        data: {
                            labels: catLabels,
                            datasets: [{
                                data: catData,
                                backgroundColor: catColors,
                                borderWidth: 0,
                                hoverOffset: 4
                            }]
                        },
                        options: {
                            responsive: true,
                            maintainAspectRatio: false,
                            cutout: '70%',
                            plugins: {
                                legend: { position: 'right', labels: { color: '#94a3b8', font: { size: 10 }, boxWidth: 12 } }
                            }
                        }
                    });
                }
            }
        } catch (err) {
            console.error("Category Chart Error: ", err);
        }

        // ============================
        // ROW 1.5: BUDGET OVERVIEW WIDGET
        // ============================
        function renderDashboardBudgets() {
            const widget = $('dashboardBudgetWidget');
            const cmk = monthKey(now);
            const activeEntries = data.entries.filter(e => isEntryActiveInMonth(e, cmk));
            
            let totalBudget = 0;
            let totalSpent = 0;
            const categoryStats = [];

            data.categories.forEach(cat => {
                if (cat.id === 'cat-savings') return;
                let catBudget = (cat.budgetOverrides && cat.budgetOverrides[cmk]) !== undefined ? cat.budgetOverrides[cmk] : (cat.budget || 0);
                if (catBudget <= 0) return;

                let catSpent = 0;
                activeEntries.forEach(e => {
                    if (e.category === cat.id) catSpent += e.amount;
                });

                totalBudget += catBudget;
                totalSpent += catSpent;
                categoryStats.push({ name: cat.name, color: cat.color, spent: catSpent, budget: catBudget, pct: Math.min((catSpent/catBudget)*100, 100) });
            });

            if (totalBudget === 0) {
                widget.innerHTML = `<div class="text-center text-slate-400 py-6">
                    <i data-lucide="wallet" class="w-10 h-10 mb-3 opacity-30 mx-auto"></i>
                    <p class="text-sm">No budgets set up yet.<br>Click 'Manage' to start tracking.</p>
                </div>`;
                refreshIcons($('budgetCategoriesContainer'));
                return;
            }

            const totalPct = Math.min((totalSpent / totalBudget) * 100, 100);
            const totalColor = totalPct >= 100 ? 'bg-rose-500' : totalPct >= 80 ? 'bg-amber-400' : 'bg-emerald-500';
            
            categoryStats.sort((a, b) => b.pct - a.pct);
            const top3 = categoryStats.slice(0, 3);

            let html = `
                <div class="mb-4">
                    <div class="flex justify-between items-end mb-2">
                        <span class="text-xs font-semibold text-slate-300 uppercase tracking-wider">Total Monthly Budget</span>
                        <div class="text-right">
                            <span class="text-lg font-bold text-white">${formatCurrency(totalSpent)}</span>
                            <span class="text-xs text-slate-400"> / ${formatCurrency(totalBudget)}</span>
                        </div>
                    </div>
                    <div class="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                        <div class="h-full ${totalColor} transition-all duration-1000" style="width: ${totalPct}%"></div>
                    </div>
                </div>
                
                <div class="mt-6">
                    <div class="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-4">Categories</div>
                    <div class="space-y-4">
            `;

            top3.forEach(c => {
                const cColor = c.pct >= 100 ? 'bg-rose-500' : c.pct >= 80 ? 'bg-amber-400' : 'bg-emerald-500';
                html += `
                    <div>
                        <div class="flex justify-between items-center mb-1">
                            <div class="flex items-center gap-2">
                                <div class="w-2 h-2 rounded-full" style="background-color: ${c.color};"></div>
                                <span class="text-sm text-slate-200">${escapeHTML(c.name)}</span>
                            </div>
                            <div class="text-sm font-medium">
                                <span class="${c.pct >= 100 ? 'text-rose-400' : 'text-slate-100'}">${formatCurrency(c.spent)}</span>
                                <span class="text-slate-500 text-xs">/ ${formatCurrency(c.budget)}</span>
                            </div>
                        </div>
                        <div class="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                            <div class="h-full ${cColor} transition-all duration-1000" style="width: ${c.pct}%"></div>
                        </div>
                    </div>
                `;
            });

            if (categoryStats.length > 3) {
                html += `<div class="text-center mt-3"><a href="#budgets" class="text-xs text-indigo-400 hover:text-indigo-300 transition-colors" onclick="$('a[href=\\'#budgets\\']').click()">View all ${categoryStats.length} categories</a></div>`;
            }

            html += `</div></div>`;
            widget.innerHTML = html;
            refreshIcons($('upcomingContainer'));
        }

        // ============================
        // ROW 4: UPCOMING BILLS
        // ============================
        try {
            const upcomingContainer = $('dashUpcomingBills');
            let upcomingBills = [];
            
            const twoWeeksFromNow = new Date();
            twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);
            
            activeEntries.forEach(e => {
                if (e.isDaily) return;
                let checkD = new Date(now.getFullYear(), now.getMonth(), Math.min(e.dueDay, daysInMonth));
                if (e.paid && e.paid[mk]) return;
                
                if (checkD <= twoWeeksFromNow) {
                    upcomingBills.push({ ...e, checkDate: checkD });
                }
            });
            
            upcomingBills.sort((a, b) => a.checkDate - b.checkDate);
            
            if (upcomingBills.length === 0) {
                upcomingContainer.innerHTML = `<div class="col-span-full flex flex-col items-center justify-center text-slate-400 py-6">
                    <i data-lucide="calendar-check" class="w-10 h-10 mb-3 opacity-30 text-emerald-500"></i>
                    <p class="text-sm">You're all caught up!<br>No bills due in the next 14 days.</p>
                </div>`;
            } else {
                upcomingContainer.innerHTML = upcomingBills.map(e => {
                    const diffTime = e.checkDate - now;
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    let dueStr = '', dueColor = '';
                    if (diffDays < 0) {
                        dueStr = `Overdue by ${Math.abs(diffDays)} days`;
                        dueColor = 'text-rose-400 font-bold';
                    } else if (diffDays === 0) {
                        dueStr = 'Due Today';
                        dueColor = 'text-yellow-400 font-bold';
                    } else {
                        dueStr = `Due in ${diffDays} days`;
                        dueColor = 'text-slate-400';
                    }
                    
                    return `
                    <div class="bg-black/20 border border-white/5 rounded-lg p-4 flex flex-col justify-between">
                        <div class="flex justify-between items-start mb-2">
                            <span class="font-medium text-slate-200 truncate pr-2">${escapeHTML(e.item)}</span>
                            <span class="font-bold text-slate-200 whitespace-nowrap">RM ${e.amount.toFixed(2)}</span>
                        </div>
                        <div class="text-xs ${dueColor}">${dueStr}</div>
                    </div>`;
                }).join('');
            }
        } catch (err) {
            console.error("Upcoming Bills Error: ", err);
        }
        
        refreshIcons();
    }

    function renderAnalytics() {
        const mk = monthKey(currentAnalyticsDate);
        $('analyticsMonthStr').textContent = currentAnalyticsDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        
        const activeEntries = data.entries.filter(e => isEntryActiveInMonth(e, mk));
        
        const catTotals = {};
        const methodTotals = {};
        
        let currentMonthExpenses = 0;
        let currentMonthSavings = 0;
        
        activeEntries.forEach(e => {
            if (e.category === 'cat-savings') {
                currentMonthSavings += e.amount;
            } else {
                currentMonthExpenses += e.amount;
                catTotals[e.category] = (catTotals[e.category] || 0) + e.amount;
            }
            
            const mId = getAssignment(e, mk) || 'method-cash';
            methodTotals[mId] = (methodTotals[mId] || 0) + e.amount;
        });

        // MoM Comparison
        let prevDate = new Date(currentAnalyticsDate);
        prevDate.setMonth(prevDate.getMonth() - 1);
        const prevMk = monthKey(prevDate);
        const prevEntries = data.entries.filter(e => isEntryActiveInMonth(e, prevMk));
        const prevMonthExpenses = prevEntries.filter(e => e.category !== 'cat-savings').reduce((s, e) => s + e.amount, 0);
        const prevMonthSavings = prevEntries.filter(e => e.category === 'cat-savings').reduce((s, e) => s + e.amount, 0);
        
        const forecastSettings = getForecastSettings();
        const monthlyIncome = forecastSettings.monthlyIncome || 0;
        
        if ($('analyticsTotalSpending')) $('analyticsTotalSpending').textContent = 'RM ' + currentMonthExpenses.toFixed(2);
        if ($('analyticsTotalSavingsCard')) $('analyticsTotalSavingsCard').textContent = 'RM ' + currentMonthSavings.toFixed(2);
        
        if ($('analyticsTotalIncome')) $('analyticsTotalIncome').textContent = 'RM ' + monthlyIncome.toFixed(2);
        if ($('analyticsTotalExpense')) $('analyticsTotalExpense').textContent = 'RM ' + currentMonthExpenses.toFixed(2);
        if ($('analyticsTotalSavings')) $('analyticsTotalSavings').textContent = 'RM ' + currentMonthSavings.toFixed(2);
        
        let incPct = 0, expPct = 0, savPct = 0;
        const totalOut = currentMonthExpenses + currentMonthSavings;
        const maxVal = Math.max(monthlyIncome, totalOut);
        
        if (maxVal > 0) {
            incPct = (monthlyIncome / maxVal) * 100;
            expPct = (currentMonthExpenses / maxVal) * 100;
            savPct = (currentMonthSavings / maxVal) * 100;
        }
        
        const netCashFlow = monthlyIncome - totalOut;
        const ncfEl = $('analyticsNetCashFlow');
        if (ncfEl) {
            ncfEl.textContent = (netCashFlow >= 0 ? '' : '-') + 'RM ' + Math.abs(netCashFlow).toFixed(2);
            ncfEl.className = 'text-sm font-bold ' + (netCashFlow >= 0 ? 'text-success' : 'text-danger');
        }
        
        if ($('analyticsIncomeBar')) $('analyticsIncomeBar').style.width = incPct + '%';
        if ($('analyticsExpenseBar')) $('analyticsExpenseBar').style.width = expPct + '%';
        if ($('analyticsSavingsBar')) $('analyticsSavingsBar').style.width = savPct + '%';

        const momContainer = $('analyticsMoM');
        if (momContainer) {
            if (prevMonthExpenses === 0) {
                momContainer.innerHTML = '';
            } else {
                const diff = ((currentMonthExpenses - prevMonthExpenses) / prevMonthExpenses) * 100;
                const isUp = diff > 0;
                const color = isUp ? 'text-danger' : 'text-success';
                const icon = isUp ? 'arrow-up-right' : 'arrow-down-right';
                momContainer.innerHTML = `<span class="${color} font-bold"><i data-lucide="${icon}" class="w-3 h-3 inline-block"></i> ${Math.abs(diff).toFixed(1)}%</span> vs last month`;
            }
        }
        
        const savMomContainer = $('analyticsSavingsMoM');
        if (savMomContainer) {
            if (prevMonthSavings === 0) {
                savMomContainer.innerHTML = '';
            } else {
                const diff = ((currentMonthSavings - prevMonthSavings) / prevMonthSavings) * 100;
                const isUp = diff > 0;
                const color = isUp ? 'text-success' : 'text-slate-400';
                const icon = isUp ? 'arrow-up-right' : (diff < 0 ? 'arrow-down-right' : 'minus');
                savMomContainer.innerHTML = `<span class="${color} font-bold"><i data-lucide="${icon}" class="w-3 h-3 inline-block"></i> ${Math.abs(diff).toFixed(1)}%</span> vs last month`;
            }
        }

        // Top 6 Expenses
        const expenseEntries = activeEntries.filter(e => e.category !== 'cat-savings');
        const topExpenses = [...expenseEntries].sort((a, b) => b.amount - a.amount).slice(0, 6);
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
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                closeModals();
            });
        });

        // ============================
        // BUDGET MODAL EVENTS
        // ============================
        window.openBudgetModal = (categoryId) => {
            const cat = data.categories.find(c => c.id === categoryId);
            if (!cat) return;
            
            $('budgetCategoryId').value = cat.id;
            $('budgetCategoryName').value = cat.name;
            
            const mk = monthKey(currentBudgetDate);
            let hasOverride = cat.budgetOverrides && cat.budgetOverrides[mk] !== undefined;
            
            $('budgetAmount').value = hasOverride ? cat.budgetOverrides[mk] : (cat.budget || '');
            $('budgetIsMonthSpecific').checked = hasOverride;
            
            // Show help text dynamically
            const helpText = $('budgetMonthSpecificHelp');
            const displayMonth = currentBudgetDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            
            $('budgetIsMonthSpecific').onchange = (e) => {
                if (e.target.checked) {
                    helpText.textContent = `Check this to override the budget specifically for ${displayMonth}.`;
                } else {
                    helpText.textContent = `Uncheck to set the global default limit for this category across all months.`;
                }
            };
            $('budgetIsMonthSpecific').dispatchEvent(new Event('change'));
            
            showModal('budgetModal');
        };

        $('budgetForm').onsubmit = (e) => {
            e.preventDefault();
            const catId = $('budgetCategoryId').value;
            const amount = parseFloat($('budgetAmount').value) || 0;
            const isMonthSpecific = $('budgetIsMonthSpecific').checked;
            
            const cat = data.categories.find(c => c.id === catId);
            if (cat) {
                if (isMonthSpecific) {
                    if (!cat.budgetOverrides) cat.budgetOverrides = {};
                    cat.budgetOverrides[currentBudgetDate] = amount;
                } else {
                    cat.budget = amount;
                }
                saveData();
                renderBudgets();
                triggerViewUpdate();
                hideModal('budgetModal');
            }
        };

        document.querySelectorAll('.nav-link-custom').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const viewId = link.getAttribute('data-view');
                if (!viewId) return;
                
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
        if (currentActiveView === 'view-dashboard') renderDashboard();
        else if (currentActiveView === 'view-budgets') renderBudgets();
        else if (currentActiveView === 'view-tracker') renderTracker();
        else if (currentActiveView === 'view-calendar' && calendar) calendar.refetchEvents();
        else if (currentActiveView === 'view-forecast') renderForecast();
        else if (currentActiveView === 'view-analytics') renderAnalytics();
        else if (currentActiveView === 'view-daily') renderDailyLog();
        else if (currentActiveView === 'view-categories') renderCategories();
        else if (currentActiveView === 'view-methods') renderMethods();
        else if (currentActiveView === 'view-goals') renderGoals();
        
        refreshIcons();
    }

    // ==========================================
    // PROFILES LOGIC
    // ==========================================
    function initProfiles() {
        const selector = $('profileSelector');
        
        // Also bind the mobile profile button
        if ($('mobileProfileBtn')) {
            $('mobileProfileBtn').onclick = () => window.showModal('profileModal');
        }

        selector.onchange = (e) => {
            if (e.target.value === activeProfileId) return;
            activeProfileId = e.target.value;
            localStorage.setItem(ACTIVE_PROFILE_KEY, activeProfileId);
            window.location.reload();
        };

        $('manageProfilesBtn').onclick = () => window.showModal('profileModal');
        
        $('addProfileForm').onsubmit = (e) => {
            e.preventDefault();
            const name = $('newProfileName').value.trim();
            if (!name) return;
            const id = 'prof_' + Date.now() + Math.floor(Math.random()*1000);
            
            const copyMethods = $('copyMethods') && $('copyMethods').checked;
            const copyEntries = $('copyEntries') && $('copyEntries').checked;
            const copySettings = $('copySettings') && $('copySettings').checked;
            
            const newProfileData = { methods: [], entries: [] };
            if (copyMethods && data.methods) newProfileData.methods = JSON.parse(JSON.stringify(data.methods));
            if (copyEntries && data.entries) newProfileData.entries = JSON.parse(JSON.stringify(data.entries));
            localStorage.setItem(STORAGE_KEY_PREFIX + id, JSON.stringify(newProfileData));
            
            if (copySettings) {
                const currentSettings = localStorage.getItem(getSettingsKey(activeProfileId));
                if (currentSettings) {
                    localStorage.setItem(getSettingsKey(id), currentSettings);
                }
            }

            profiles.push({ id, name });
            localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
            $('newProfileName').value = '';
            renderProfiles();
            
            // Switch to the newly created profile
            activeProfileId = id;
            localStorage.setItem(ACTIVE_PROFILE_KEY, activeProfileId);
            window.location.reload();
        };
    }

    function renderProfiles() {
        const selector = $('profileSelector');
        selector.innerHTML = profiles.map(p => `<option value="${p.id}" ${p.id === activeProfileId ? 'selected' : ''}>${escapeHTML(p.name)}</option>`).join('');

        const list = $('profilesList');
        list.innerHTML = profiles.map(p => `
            <div class="flex justify-between items-center bg-black/20 border border-white/5 rounded-lg p-3">
                <span class="font-medium text-slate-100">${escapeHTML(p.name)} ${p.id === activeProfileId ? '<span class="text-xs bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded-full ml-2">Active</span>' : ''}</span>
                <div class="flex items-center gap-2">
                    <button class="text-slate-400 hover:text-white transition-colors" onclick="renameProfile('${p.id}')" aria-label="Rename Profile">
                        <i data-lucide="edit-2" class="w-4 h-4"></i>
                    </button>
                    ${p.id !== 'default' && p.id !== activeProfileId ? `
                    <button class="text-rose-400 hover:text-rose-300 transition-colors" onclick="deleteProfile('${p.id}')" aria-label="Delete Profile">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                    ` : ''}
                </div>
            </div>
        `).join('');
        refreshIcons();
    }

    window.renameProfile = (id) => {
        const prof = profiles.find(p => p.id === id);
        if (!prof) return;
        const newName = prompt('Enter new name for profile:', prof.name);
        if (newName && newName.trim() !== '') {
            prof.name = newName.trim();
            localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
            renderProfiles();
        }
    };

    window.deleteProfile = (id) => {
        if (!confirm('Are you sure you want to delete this profile? All its data will be permanently lost.')) return;
        profiles = profiles.filter(p => p.id !== id);
        localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
        localStorage.removeItem(STORAGE_KEY_PREFIX + id);
        renderProfiles();
    };

    // ==========================================
    // DAILY LOG LOGIC
    // ==========================================
    function initDailyLog() {
        const dateInput = $('dailyLogDate');
        
        const pad = n => String(n).padStart(2, '0');
        const updateDate = () => {
            const ymd = `${currentDailyDate.getFullYear()}-${pad(currentDailyDate.getMonth()+1)}-${pad(currentDailyDate.getDate())}`;
            if (dateInput.value !== ymd) {
                if (dateInput._flatpickr) dateInput._flatpickr.setDate(ymd, false);
                else dateInput.value = ymd;
            }
            renderDailyLog();
        };

        $('prevDayBtn').onclick = () => { currentDailyDate.setDate(currentDailyDate.getDate() - 1); updateDate(); };
        $('nextDayBtn').onclick = () => { currentDailyDate.setDate(currentDailyDate.getDate() + 1); updateDate(); };
        $('resetDailyDateBtn').onclick = () => { currentDailyDate = new Date(); updateDate(); };
        
        dateInput.onchange = (e) => {
            if (e.target.value) {
                // Parse local date from yyyy-mm-dd
                const [y, m, d] = e.target.value.split('-');
                currentDailyDate = new Date(y, parseInt(m)-1, d);
                renderDailyLog();
            }
        };
        
        updateDate(); // Initialize date picker value
        
        $('dailyEntryForm').onsubmit = (e) => {
            e.preventDefault();
            const item = $('dailyEntryItem').value.trim();
            const amount = parseFloat($('dailyEntryAmount').value);
            const type = 'one-off';
            const category = $('dailyEntryCategory').value;
            const methodId = $('dailyEntryMethod').value;
            
            // Derive startMonth and dueDay from currentDailyDate
            const pad = n => String(n).padStart(2, '0');
            const ymd = `${currentDailyDate.getFullYear()}-${pad(currentDailyDate.getMonth()+1)}-${pad(currentDailyDate.getDate())}`;
            const [sy, sm, sd] = ymd.split('-');
            const startMonth = `${sy}-${sm}`;
            const dueDay = parseInt(sd);

            data.entries.push({ 
                id: uuid(), item, amount, dueDay, due: dueDay, 
                assignments: { [startMonth]: methodId }, 
                paid: { [startMonth]: true }, order: {}, 
                type, category, startMonth, endMonth: type === 'one-off' ? startMonth : undefined,
                isDaily: true
            });
            
            $('dailyEntryItem').value = '';
            $('dailyEntryAmount').value = '';
            
            // Sync calendar and analytics if needed
            currentAnalyticsDate = new Date(currentDailyDate.getFullYear(), currentDailyDate.getMonth(), 1);
            currentTrackerMonth = new Date(currentDailyDate.getFullYear(), currentDailyDate.getMonth(), 1);
            if (calendar) calendar.gotoDate(currentTrackerMonth);
            
            saveData();
            // renderDailyLog is called by triggerViewUpdate
        };
    }

    function renderDailyLog() {
        $('dailyLogTitleStr').textContent = currentDailyDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
        
        const pad = n => String(n).padStart(2, '0');
        const ymd = `${currentDailyDate.getFullYear()}-${pad(currentDailyDate.getMonth()+1)}-${pad(currentDailyDate.getDate())}`;
        const [sy, sm, sd] = ymd.split('-');
        const mk = `${sy}-${sm}`;
        const day = parseInt(sd);
        
        const activeEntries = data.entries.filter(e => isEntryActiveInMonth(e, mk));
        
        const daysInMonth = new Date(currentDailyDate.getFullYear(), currentDailyDate.getMonth() + 1, 0).getDate();
        const dayEntries = activeEntries.filter(e => {
            const effectiveDueDay = Math.min(e.dueDay, daysInMonth);
            return effectiveDueDay === day;
        });
        
        let total = 0;
        const container = $('dailyEntriesContainer');
        
        if (dayEntries.length === 0) {
            container.innerHTML = `
            <div class="flex flex-col items-center justify-center text-center py-12">
                <div class="w-24 h-24 bg-indigo-500/10 rounded-full flex items-center justify-center mb-4 relative">
                    <div class="absolute inset-0 bg-indigo-500/20 rounded-full animate-ping opacity-20"></div>
                    <i data-lucide="sun" class="w-12 h-12 text-indigo-400"></i>
                </div>
                <h4 class="text-xl font-bold mb-2 text-slate-200">Looks like a quiet day.</h4>
                <p class="text-slate-400 max-w-sm mb-6">You have no expenses or income tracked for this date.</p>
                <button class="bg-indigo-500 hover:bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-medium transition-all shadow-lg shadow-indigo-500/25 flex items-center gap-2 mx-auto" onclick="document.getElementById('dailyEntryItem').focus()">
                    <i data-lucide="plus" class="w-5 h-5"></i> Add your first entry
                </button>
            </div>`;
        } else {
            container.innerHTML = dayEntries.map(e => {
                total += e.amount;
                const catObj = data.categories.find(c => c.id === e.category) || { name: 'Misc', color: '#9ca3af' };
                const mId = getAssignment(e, mk) || data.methods[0]?.id;
                const mObj = data.methods.find(m => m.id === mId);
                const isPaid = e.paid && e.paid[mk];
                
                return `
                <div class="flex items-center justify-between p-3 bg-black/20 border border-white/5 rounded-lg group hover:bg-white/5 transition-colors">
                    <div class="flex items-center gap-3">
                        <div class="w-2 h-2 rounded-full" style="background-color: ${catObj.color}"></div>
                        <div>
                            <div class="font-bold text-slate-100">${escapeHTML(e.item)}</div>
                            <div class="text-xs text-slate-400 flex items-center gap-2">
                                <span>${escapeHTML(catObj.name)}</span>
                                <span class="w-1 h-1 rounded-full bg-slate-600"></span>
                                <span>${mObj ? escapeHTML(getMethodName(mObj, mk)) : 'N/A'}</span>
                            </div>
                        </div>
                    </div>
                    <div class="flex items-center gap-3">
                        <div class="text-right">
                            <div class="font-bold text-white">RM ${e.amount.toFixed(2)}</div>
                            <div class="text-[10px] uppercase font-bold tracking-wider ${isPaid ? 'text-emerald-400' : 'text-amber-400'}">${isPaid ? 'Paid' : 'Unpaid'}</div>
                        </div>
                        <button onclick="window.openEntryModal('${e.id}')" class="opacity-0 group-hover:opacity-100 p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-all" title="Edit">
                            <i data-lucide="edit-2" class="w-4 h-4"></i>
                        </button>
                    </div>
                </div>
                `;
            }).join('');
        }
        
        $('dailyTotalAmount').textContent = 'RM ' + total.toFixed(2);
        
        // Populate Daily Entry Form Selects
        const methodSelect = $('dailyEntryMethod');
        methodSelect.innerHTML = data.methods.map(m => `<option value="${m.id}">${escapeHTML(getMethodName(m, mk))}</option>`).join('');
        
        const catSelect = $('dailyEntryCategory');
        catSelect.innerHTML = data.categories.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('');
        
        refreshIcons();
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
        initProfiles();
        initDailyLog();
        
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
            localStorage.setItem(getSettingsKey(), JSON.stringify(s));
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
            localStorage.setItem(getSettingsKey(), JSON.stringify(s));
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
        $('resetTrackerMonth').onclick = () => { currentTrackerMonth = new Date(); currentTrackerMonth.setDate(1); renderTracker(); syncCal(); };
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
        let hasAnyEntries = false;
        const methodItems = {};

        data.methods.forEach(m => {
            const items = data.entries
                .filter(e => {
                    if (e.isDaily) return false;
                    if (e.startMonth && mon < e.startMonth) return false;
                    if (e.type !== 'one-off' && e.endMonth && mon > e.endMonth) return false;
                    if (e.type === 'one-off' && mon !== e.startMonth) return false;
                    
                    const assignedMethod = getOriginalAssignment(e, mon);
                    return assignedMethod === m.id;
                })
                .sort((a, b) => getOrder(a, mon) - getOrder(b, mon));
            
            methodItems[m.id] = items;
            if (items.length > 0) hasAnyEntries = true;
        });

        if (!hasAnyEntries) {
            c.innerHTML = `
            <div class="flex flex-col items-center justify-center text-center py-16">
                <div class="w-24 h-24 bg-indigo-500/10 rounded-full flex items-center justify-center mb-4 relative">
                    <div class="absolute inset-0 bg-indigo-500/20 rounded-full animate-ping opacity-20"></div>
                    <i data-lucide="list-todo" class="w-12 h-12 text-indigo-400"></i>
                </div>
                <h4 class="text-xl font-bold mb-2 text-slate-200">Your month is clear.</h4>
                <p class="text-slate-400 max-w-sm mb-6">You have no recurring bills or entries tracked for this month.</p>
                <button class="bg-indigo-500 hover:bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-medium transition-all shadow-lg shadow-indigo-500/25 flex items-center gap-2 mx-auto" onclick="showModal('entryModal')">
                    <i data-lucide="plus" class="w-5 h-5"></i> Add a recurring entry
                </button>
            </div>`;
            ['totalAmount', 'paidAmount', 'dueAmount'].forEach(id => $(id).textContent = 'RM 0.00');
            methodSortable?.destroy();
            entrySortables.forEach(s => s.destroy());
            refreshIcons(c);
            return;
        }

        data.methods.forEach(m => {
            const items = methodItems[m.id];

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
    function renderDayCellContent(arg) {
        const mk = `${String(arg.date.getFullYear())}-${String(arg.date.getMonth() + 1).padStart(2, '0')}`;
        const day = arg.date.getDate();
        const daysInMonth = new Date(arg.date.getFullYear(), arg.date.getMonth() + 1, 0).getDate();
        
        let filtered = data.entries.filter(e => isEntryActiveInMonth(e, mk));
        if (calendarExpenseType === 'Monthly') {
            filtered = filtered.filter(e => !e.isDaily);
        } else if (calendarExpenseType === 'Daily') {
            filtered = filtered.filter(e => e.isDaily);
        }
        let total = 0;
        filtered.forEach(e => {
            const effectiveDueDay = Math.min(e.dueDay, daysInMonth);
            if (effectiveDueDay === day) total += e.amount;
        });
        
        let html = ``;
        if (total > 0) {
            html += `
                <div class="day-cell-wrapper w-full flex justify-between items-center px-1 pt-1">
                    <div class="text-[11px] font-bold text-white px-1.5 py-0.5 rounded bg-indigo-500/20 border border-indigo-500/30 whitespace-nowrap">Total: RM ${total.toFixed(2)}</div>
                    <div class="ml-auto">${arg.dayNumberText}</div>
                </div>
            `;
        } else {
            html = arg.dayNumberText;
        }
        return { html: html };
    }

    function initCalendar() {
        const calendarEl = document.getElementById('calendar');
        
        calendar = new FullCalendar.Calendar(calendarEl, {
            initialView: 'dayGridMonth',
            themeSystem: 'standard',
            height: '100%',
            dayMaxEvents: true, // Shows "+2 more" popup instead of stretching rows
            showNonCurrentDates: false,
            fixedWeekCount: false,
            headerToolbar: { left: 'prev,next today', center: 'title', right: '' },
            selectable: true,
            dayCellContent: renderDayCellContent,
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
                    let filtered = data.entries.filter(e => isEntryActiveInMonth(e, mk));
                    if (calendarExpenseType === 'Monthly') {
                        filtered = filtered.filter(e => !e.isDaily);
                    } else if (calendarExpenseType === 'Daily') {
                        filtered = filtered.filter(e => e.isDaily);
                    }
                    
                    const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

                    filtered.forEach(e => {
                        const effectiveDueDay = Math.min(e.dueDay, daysInMonth);
                        const eventDate = new Date(d.getFullYear(), d.getMonth(), effectiveDueDay);
                        if (eventDate >= fetchInfo.start && eventDate < fetchInfo.end) {
                            const isPaid = e.paid?.[mk];
                            const now = new Date();
                            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                            const isPast = eventDate < todayStart;
                            const color = isPaid ? '#059669' : (isPast ? '#e11d48' : '#d97706');
                            
                            const pad = n => String(n).padStart(2, '0');
                            const eventStart = `${eventDate.getFullYear()}-${pad(eventDate.getMonth()+1)}-${pad(eventDate.getDate())}`;
                            
                            const titlePrefix = e.isDaily ? '[Daily] ' : '';
                            events.push({
                                id: e.id,
                                title: `${titlePrefix}${e.item} (RM ${e.amount.toFixed(2)})`,
                                start: eventStart,
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
        
        document.querySelectorAll('.cal-filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.cal-filter-btn').forEach(b => {
                    b.classList.remove('active', 'bg-indigo-500/20', 'text-white', 'shadow-sm');
                    b.classList.add('text-slate-400');
                });
                btn.classList.add('active', 'bg-indigo-500/20', 'text-white', 'shadow-sm');
                btn.classList.remove('text-slate-400');
                calendarExpenseType = btn.dataset.filter;
                if (calendar) {
                    calendar.setOption('dayCellContent', (arg) => renderDayCellContent(arg));
                    calendar.refetchEvents();
                }
            });
        });

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
        const s = localStorage.getItem(getSettingsKey());
        if (s) {
            const p = safeJSONParse(s, def);
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
                <label class="d-block text-truncate" title="${escapeHTML(e.item)}">${escapeHTML(e.item)} <span class="text-muted fw-normal">(RM ${e.amount.toFixed(2)})</span></label>
                <select class="form-select form-select-sm" data-entry-id="${e.id}">${selectStr}</select>
            `;
            const sel = div.querySelector('select');
            sel.value = settings.entryEndDates[e.id] || "";
            
            sel.addEventListener('change', (ev) => {
                const s = getForecastSettings();
                if(ev.target.value === "") delete s.entryEndDates[e.id];
                else s.entryEndDates[e.id] = ev.target.value;
                localStorage.setItem(getSettingsKey(), JSON.stringify(s));
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
        
        // ============================
        // GOAL MODAL EVENTS
        // ============================
        window.openGoalEditModal = (goalId) => {
            const form = $('goalEditForm');
            if (!form) return;
            form.reset();
            
            if (goalId) {
                const goal = data.goals.find(g => g.id === goalId);
                if (goal) {
                    $('goalModalLabel').textContent = 'Edit Goal';
                    $('goalName').value = goal.name;
                    $('goalTarget').value = goal.targetAmount;
                    $('goalCurrent').value = getGoalCurrentAmount(goalId);
                    $('goalDate').value = goal.targetDate;
                    form.dataset.editId = goal.id;
                    $('goalSubmitBtn').textContent = 'Save Changes';
                    window.showModal('goalModal');
                }
            }

            showModal('goalModal');
        };

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
                    legend: { display: false },
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
                localStorage.setItem(getSettingsKey(), JSON.stringify(s));
                $('oneOffForm').reset();
                renderForecast();
            };
        }
    }

    // ==========================================
    // CATEGORIES VIEW LOGIC
    // ==========================================
    function initCategories() {
        $('addCategoryForm').onsubmit = (e) => {
            e.preventDefault();
            const name = $('addCategoryName').value.trim();
            const color = $('addCategoryColor').value;
            
            if (!name) return;
            if (data.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
                return alert('Category already exists');
            }

            data.categories.push({ id: 'cat-' + uuid(), name, color });
            saveData();
            $('addCategoryForm').reset();
            renderCategories();
        };

        $('categoryEditForm').onsubmit = (e) => {
            e.preventDefault();
            const name = $('categoryName').value.trim();
            const color = $('categoryColor').value;
            const eid = $('categoryEditForm').dataset.editId;
            
            if (!name || !eid) return;

            if (data.categories.some(c => c.name.toLowerCase() === name.toLowerCase() && c.id !== eid)) {
                return alert('Category already exists');
            }

            const c = data.categories.find(x => x.id === eid);
            if (c) {
                c.name = name;
                c.color = color;
                saveData();
            }
            
            window.hideModal('categoryModal');
        };
        
        $('categoryModal').addEventListener('hidden.custom.modal', () => $('categoryEditForm').reset());
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
                $('categoryEditForm').dataset.editId = c.id;
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
        $('addMethodForm').onsubmit = (e) => {
            e.preventDefault();
            const mon = monthKey(currentTrackerMonth);
            const name = $('addMethodName').value.trim();
            const color = $('addMethodColor').value;
            
            if (!name) return;
            if (data.methods.some(m => getMethodName(m, mon).toLowerCase() === name.toLowerCase())) {
                return alert('Payment method already exists');
            }

            data.methods.push({ 
                id: 'method-' + uuid(), 
                name, 
                names: { [mon]: name },
                color: color 
            });
            saveData();
            $('addMethodForm').reset();
            renderMethods();
        };

        $('methodEditForm').onsubmit = (e) => {
            e.preventDefault();
            const mon = monthKey(currentTrackerMonth);
            const name = $('methodName').value.trim();
            const color = $('methodColor').value;
            const eid = $('methodEditForm').dataset.editId;
            
            if (!name || !eid) return;

            if (data.methods.some(m => getMethodName(m, mon).toLowerCase() === name.toLowerCase() && m.id !== eid)) {
                return alert('Payment method already exists');
            }

            const m = data.methods.find(x => x.id === eid);
            if (m) {
                m.names = m.names || {};
                m.names[mon] = name;
                m.color = color;
                saveData();
            }
            
            window.hideModal('methodModal');
        };
        
        $('methodModal').addEventListener('hidden.custom.modal', () => $('methodEditForm').reset());
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
                const startVal = ent.startMonth || mon;
                const endVal = ent.endMonth || '';
                $('entryStart').value = startVal;
                if ($('entryStart')._flatpickr) $('entryStart')._flatpickr.setDate(startVal, false);
                $('entryEnd').value = endVal;
                if ($('entryEnd')._flatpickr) {
                    if (endVal) $('entryEnd')._flatpickr.setDate(endVal, false);
                    else $('entryEnd')._flatpickr.clear(false);
                }
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
            if ($('entryStart')._flatpickr) $('entryStart')._flatpickr.setDate(mon, false);
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
            
            if (ent.category !== 'cat-savings') {
                delete ent.goalId;
            }

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
        
        // Sync dates to the newly added entry's month so it shows up immediately in Analytics/Tracker
        if (!currentEditEntryId && startMonth) {
            const [sy, sm] = startMonth.split('-');
            currentAnalyticsDate = new Date(parseInt(sy), parseInt(sm) - 1, 1);
            currentTrackerMonth = new Date(parseInt(sy), parseInt(sm) - 1, 1);
            if (calendar) calendar.gotoDate(currentTrackerMonth);
        }
        
        saveData();
        triggerViewUpdate();
        window.hideModal('entryModal');
    };
    // Cleanup on hide
    $('entryModal').addEventListener('hidden.custom.modal', () => $('entryForm').reset());
    $('methodModal').addEventListener('hidden.custom.modal', () => $('methodName').value = '');
    // ==========================================
    // DATA MANAGEMENT VIEW LOGIC
    // ==========================================
    
    if ($('exportCurrentBtn')) {
        $('exportCurrentBtn').onclick = () => {
            const exportData = { ...data, forecastSettings: getForecastSettings() };
            downloadJson(exportData, `paytrack-${activeProfileId}-backup-${monthKey(new Date())}.json`);
        };
    }
    
    if ($('exportAllBtn')) {
        $('exportAllBtn').onclick = () => {
            let allData = { 
                type: 'paytrack_all_profiles',
                profiles: profiles,
                data: {}
            };
            
            profiles.forEach(p => {
                const pDataStr = localStorage.getItem(`paytrack_data_${p.id}`);
                const pSettingsStr = localStorage.getItem(`paytrack_forecast_settings_${p.id}`);
                
                let pData = { entries: [], methods: [], categories: [], goals: [] };
                let pSettings = { horizon: 6, monthlyIncome: 5000, fixedExpenses: [] };
                
                if (pDataStr) pData = safeJSONParse(pDataStr, pData);
                if (pSettingsStr) pSettings = safeJSONParse(pSettingsStr, pSettings);
                
                allData.data[p.id] = { ...pData, forecastSettings: pSettings };
            });
            
            downloadJson(allData, `paytrack-ALL-backup-${monthKey(new Date())}.json`);
        };
    }
    
    function downloadJson(dataObj, filename) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(dataObj, null, 2)], { type: 'application/json' }));
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    if ($('dataImportInput')) {
        $('dataImportInput').onchange = (e) => {
            const f = e.target.files[0];
            if(!f) return;
            const r = new FileReader();
            r.onload = () => {
                try {
                    const imp = JSON.parse(r.result);
                    window.pendingImportData = null;
                    
                    if (imp.type === 'paytrack_all_profiles') {
                        window.pendingImportData = imp;
                        $('importPreviewTitle').textContent = 'All Profiles Backup';
                        $('importPreviewType').textContent = 'Full Database Restore';
                        $('importPreviewType').className = 'text-sm text-amber-400 m-0';
                        $('importPreviewStats').innerHTML = `<div class="flex justify-between text-sm"><span class="text-slate-400">Profiles:</span><span class="font-medium text-white">${imp.profiles.length}</span></div>`;
                    } else {
                        let finalImp = { methods: [], entries: [], categories: [], goals: [] };
                        if (Array.isArray(imp)) {
                            finalImp.entries = imp;
                        } else if (typeof imp === 'object') {
                            finalImp.entries = imp.entries || imp.items || [];
                            finalImp.methods = imp.methods || imp.payments || [];
                            finalImp.categories = imp.categories || [];
                            finalImp.goals = imp.goals || [];
                            finalImp.forecastSettings = imp.forecastSettings;
                        } else {
                            throw new Error('Invalid format');
                        }
                        
                        finalImp.entries = finalImp.entries.map(ent => {
                            if (!ent.startMonth) {
                                if (ent.month) ent.startMonth = ent.month;
                                else if (ent.date) ent.startMonth = ent.date.substring(0, 7);
                                else if (ent.startDate) ent.startMonth = ent.startDate.substring(0, 7);
                                else ent.startMonth = monthKey(new Date()); 
                            }
                            if (ent.type === 'one-off' && !ent.endMonth) ent.endMonth = ent.startMonth;
                            if (ent.isDaily && !ent.dueDay) {
                                if (ent.date && ent.date.length >= 10) ent.dueDay = parseInt(ent.date.substring(8, 10));
                                else ent.dueDay = 1;
                            }
                            return ent;
                        });
                        
                        window.pendingImportData = { type: 'single', data: finalImp };
                        $('importPreviewTitle').textContent = 'Single Profile Backup';
                        $('importPreviewType').textContent = window.importTarget === 'new' ? 'Will create a new profile' : 'Will overwrite active profile';
                        $('importPreviewType').className = window.importTarget === 'new' ? 'text-sm text-indigo-400 m-0' : 'text-sm text-rose-400 m-0';
                        
                        $('importPreviewStats').innerHTML = `
                            <div class="flex justify-between text-sm mb-2"><span class="text-slate-400">Transactions:</span><span class="font-medium text-white">${finalImp.entries.length}</span></div>
                            <div class="flex justify-between text-sm mb-2"><span class="text-slate-400">Categories:</span><span class="font-medium text-white">${finalImp.categories.length}</span></div>
                            <div class="flex justify-between text-sm"><span class="text-slate-400">Goals:</span><span class="font-medium text-white">${finalImp.goals.length}</span></div>
                        `;
                    }
                    
                    refreshIcons();
                    window.showModal('dataImportModal');
                } catch (err) { alert('Import failed: ' + err.message); }
            };
            r.readAsText(f);
            e.target.value = '';
        };
    }
    
    if ($('confirmImportBtn')) {
        $('confirmImportBtn').onclick = () => {
            if (!window.pendingImportData) return;
            const imp = window.pendingImportData;
            
            if (imp.type === 'paytrack_all_profiles') {
                localStorage.clear();
                localStorage.setItem(PROFILES_KEY, JSON.stringify(imp.profiles));
                if (imp.profiles.length > 0) {
                    localStorage.setItem(ACTIVE_PROFILE_KEY, imp.profiles[0].id);
                }
                Object.keys(imp.data).forEach(pId => {
                    const pData = imp.data[pId];
                    if (pData.forecastSettings) {
                        localStorage.setItem(`paytrack_forecast_settings_${pId}`, JSON.stringify(pData.forecastSettings));
                        delete pData.forecastSettings;
                    }
                    localStorage.setItem(`paytrack_data_${pId}`, JSON.stringify(pData));
                });
                window.location.reload();
            } else if (imp.type === 'single') {
                const finalImp = imp.data;
                if (window.importTarget === 'new') {
                    const newId = 'profile_' + Date.now();
                    const newName = 'Imported Profile ' + new Date().toLocaleDateString();
                    profiles.push({ id: newId, name: newName });
                    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
                    if (finalImp.forecastSettings) {
                        localStorage.setItem(`paytrack_forecast_settings_${newId}`, JSON.stringify(finalImp.forecastSettings));
                        delete finalImp.forecastSettings;
                    }
                    localStorage.setItem(`paytrack_data_${newId}`, JSON.stringify(finalImp));
                    localStorage.setItem(ACTIVE_PROFILE_KEY, newId);
                    window.location.reload();
                } else {
                    if (finalImp.forecastSettings) {
                        localStorage.setItem(getSettingsKey(), JSON.stringify(finalImp.forecastSettings));
                    }
                    data = finalImp; 
                    saveData(); 
                    window.location.reload();
                }
            }
            window.hideModal('dataImportModal');
            window.pendingImportData = null;
        };
    }

    window.promptClearData = (type) => {
        window.clearTarget = type;
        const msg = type === 'all' 
            ? "You are about to completely wipe all profiles and data. This is a factory reset and is irreversible. Are you sure?"
            : "You are about to permanently delete the current active profile. This action cannot be undone. Are you sure?";
        $('dataConfirmMessage').textContent = msg;
        window.showModal('dataConfirmModal');
    };

    if ($('confirmDestructiveBtn')) {
        $('confirmDestructiveBtn').onclick = () => {
            if (window.clearTarget === 'all') {
                localStorage.clear();
            } else if (window.clearTarget === 'current') {
                localStorage.removeItem(STORAGE_KEY_PREFIX + activeProfileId);
                localStorage.removeItem(getSettingsKey());
                profiles = profiles.filter(p => p.id !== activeProfileId);
                if (profiles.length === 0) {
                    localStorage.clear();
                } else {
                    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
                    localStorage.setItem(ACTIVE_PROFILE_KEY, profiles[0].id);
                }
            }
            window.location.reload();
        };
    }
    // ==========================================
    // GOALS VIEW LOGIC
    // ==========================================
    let goalCharts = [];
    let masterGoalChart = null;
    let compactGoalIds = new Set();
    let expandedGoalIds = new Set();

    function getGoalCurrentAmount(goalId) {
        return data.entries
            .filter(e => e.goalId === goalId || e.category === goalId)
            .reduce((sum, e) => sum + e.amount, 0);
    }

    function initGoals() {
        const addForm = $('addGoalForm');
        if (addForm) {
            addForm.onsubmit = (e) => {
                e.preventDefault();
                const name = $('addGoalName').value.trim();
                const targetAmount = parseFloat($('addGoalTarget').value) || 0;
                const currentAmount = parseFloat($('addGoalCurrent').value) || 0;
                const targetDate = $('addGoalDate').value;
                if (!name || targetAmount <= 0 || !targetDate) return;
                
                const goalId = 'goal-' + Date.now();
                data.goals.push({ id: goalId, name, targetAmount, targetDate });
                
                if (currentAmount > 0) {
                    const curMonth = monthKey(new Date());
                    data.entries.push({
                        id: 'entry-' + Date.now() + Math.random().toString(36).substr(2, 5),
                        item: `Initial Savings`,
                        amount: currentAmount,
                        dueDay: new Date().getDate(),
                        due: new Date().getDate(),
                        assignments: { [curMonth]: data.methods.length ? data.methods[0].id : 'method-cash' },
                        paid: { [curMonth]: true },
                        order: {},
                        type: 'one-off',
                        category: 'cat-savings',
                        startMonth: curMonth,
                        endMonth: curMonth,
                        isDaily: true,
                        goalId: goalId
                    });
                }
                
                saveData();
                renderGoals();
                addForm.reset();
            };
        }

        const editForm = $('goalEditForm');
        if (editForm) {
            editForm.onsubmit = (e) => {
                e.preventDefault();
                const name = $('goalName').value.trim();
                const targetAmount = parseFloat($('goalTarget').value) || 0;
                const currentAmount = parseFloat($('goalCurrent').value) || 0;
                const targetDate = $('goalDate').value;
                const goalId = editForm.dataset.editId;
                if (!name || targetAmount <= 0 || !targetDate || !goalId) return;
                
                const goal = data.goals.find(g => g.id === goalId);
                if (goal) {
                    goal.name = name;
                    goal.targetAmount = targetAmount;
                    goal.targetDate = targetDate;
                }
                
                data.entries = data.entries.filter(en => en.category !== goalId && en.goalId !== goalId);
                if (currentAmount > 0) {
                    const curMonth = monthKey(new Date());
                    data.entries.push({
                        id: 'entry-' + Date.now() + Math.random().toString(36).substr(2, 5),
                        item: `Initial / Adjusted Savings`,
                        amount: currentAmount,
                        dueDay: new Date().getDate(),
                        due: new Date().getDate(),
                        assignments: { [curMonth]: data.methods.length ? data.methods[0].id : 'method-cash' },
                        paid: { [curMonth]: true },
                        order: {},
                        type: 'one-off',
                        category: 'cat-savings',
                        startMonth: curMonth,
                        endMonth: curMonth,
                        isDaily: true,
                        goalId: goalId
                    });
                }
                
                saveData();
                renderGoals();
                window.hideModal('goalModal');
            };
        }
        
        $('goalModal').addEventListener('hidden.custom.modal', () => {
            if(editForm) editForm.reset();
        });
    }

    function renderMasterGoalChart() {
        const ctx = document.getElementById('goalsMasterChart');
        if (!ctx) return;
        
        if (masterGoalChart) {
            masterGoalChart.destroy();
            masterGoalChart = null;
        }
        
        let maxMonths = 12;
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        
        data.goals.forEach(g => {
            if (!g.targetDate) return;
            const [tYear, tMonth] = g.targetDate.split('-');
            const m = (parseInt(tYear) - currentYear) * 12 + (parseInt(tMonth) - currentMonth);
            if (m > maxMonths) maxMonths = m;
        });
        
        const labels = [];
        const aggregatedTarget = new Array(maxMonths + 1).fill(0);
        
        for (let i = 0; i <= maxMonths; i++) {
            const d = new Date(currentYear, currentMonth - 1 + i, 1);
            labels.push(d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
        }
        
        data.goals.forEach(g => {
            if (!g.targetDate) return;
            const [tYear, tMonth] = g.targetDate.split('-');
            const totalM = (parseInt(tYear) - currentYear) * 12 + (parseInt(tMonth) - currentMonth);
            const m = Math.max(1, totalM);
            const currentAmt = getGoalCurrentAmount(g.id);
            const req = Math.max(0, g.targetAmount - currentAmt) / m;
            
            for (let i = 0; i <= maxMonths; i++) {
                if (i <= m) {
                    aggregatedTarget[i] += currentAmt + (req * i);
                } else {
                    aggregatedTarget[i] += g.targetAmount;
                }
            }
        });
        
        masterGoalChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Total Savings Target Trajectory',
                        data: aggregatedTarget,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        borderWidth: 2,
                        fill: true,
                        pointRadius: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#94a3b8' } },
                    y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } }
                },
                interaction: {
                    mode: 'index',
                    intersect: false
                }
            }
        });
    }

    function renderIndividualGoalChart(goal) {
        const ctx = document.getElementById('goalChart-' + goal.id);
        if (!ctx) return;
        
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;
        
        const [tYear, tMonth] = goal.targetDate.split('-');
        const targetYear = parseInt(tYear);
        const targetMonth = parseInt(tMonth);
        
        const goalEntries = data.entries.filter(e => e.goalId === goal.id);
        let earliestDate = new Date(currentYear, currentMonth - 1, 1);
        goalEntries.forEach(e => {
            if (!e.startMonth) {
                // Recover corrupted goal entries
                e.startMonth = monthKey(new Date());
            }
            const [y, m] = e.startMonth.split('-');
            const d = new Date(parseInt(y), parseInt(m) - 1, 1);
            if (d < earliestDate) earliestDate = d;
        });
        
        const totalMonths = (targetYear - earliestDate.getFullYear()) * 12 + (targetMonth - earliestDate.getMonth());
        const months = Math.max(1, totalMonths);
        
        const labels = [];
        const targetData = [];
        const actualData = [];
        
        let cumulativeActual = 0;
        
        for (let i = 0; i <= months; i++) {
            const d = new Date(earliestDate.getFullYear(), earliestDate.getMonth() + i, 1);
            labels.push(d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
            
            targetData.push(goal.targetAmount * (i / months));
            
            if (d.getTime() <= new Date(currentYear, currentMonth - 1, 1).getTime()) {
                const mk = monthKey(d);
                const monthAdded = goalEntries.filter(e => e.startMonth === mk).reduce((s, e) => s + e.amount, 0);
                cumulativeActual += monthAdded;
                actualData.push(cumulativeActual);
            } else {
                actualData.push(null);
            }
        }
        
        const chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Required Trajectory',
                        data: targetData,
                        borderColor: 'rgba(99, 102, 241, 0.4)',
                        borderDash: [5, 5],
                        borderWidth: 2,
                        pointRadius: 0,
                        fill: false
                    },
                    {
                        label: 'Actual Saved',
                        data: actualData,
                        borderColor: '#6366f1',
                        backgroundColor: '#6366f1',
                        borderWidth: 3,
                        pointRadius: 4,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } }, display: false },
                    y: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } }, display: false }
                },
                layout: { padding: 0 },
                interaction: {
                    mode: 'index',
                    intersect: false
                }
            }
        });
        goalCharts.push(chart);
    }

    function renderGoals() {
        const list = $('goalsList');
        const completedList = $('completedGoalsList');
        const heading = $('completedGoalsHeading');
        if (!list || !completedList) return;
        
        goalCharts.forEach(c => c.destroy());
        goalCharts = [];
        
        if (!data.goals || data.goals.length === 0) {
            list.innerHTML = `<div style="column-span: all; -webkit-column-span: all;" class="text-center py-10 text-slate-500 bg-black/20 rounded-xl border border-white/5 w-full block">
                <i data-lucide="target" class="w-12 h-12 mx-auto mb-3 opacity-20"></i>
                <p>No goals set yet. Create your first saving goal above.</p>
            </div>`;
            completedList.innerHTML = '';
            if (heading) heading.classList.add('hidden');
            const mgc = $('goalsMasterGraphContainer');
            if (mgc) mgc.classList.add('hidden');
            refreshIcons();
            return;
        }

        const mgc = $('goalsMasterGraphContainer');
        if (mgc) mgc.classList.remove('hidden');

        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1; // 1-12

        const activeHtml = [];
        const completedHtml = [];

        data.goals.forEach(goal => {
            const [tYear, tMonth] = goal.targetDate.split('-');
            const targetYear = parseInt(tYear);
            const targetMonth = parseInt(tMonth);
            
            const currentAmt = getGoalCurrentAmount(goal.id);
            const monthsRemaining = (targetYear - currentYear) * 12 + (targetMonth - currentMonth);
            const shortfall = goal.targetAmount - currentAmt;
            let requiredMonthly = 0;
            if (monthsRemaining > 0) requiredMonthly = Math.max(0, shortfall) / monthsRemaining;
            else if (monthsRemaining === 0) requiredMonthly = Math.max(0, shortfall);
            else requiredMonthly = Math.max(0, shortfall);
            
            const isCompleted = shortfall <= 0;
            const progress = goal.targetAmount > 0 ? currentAmt / goal.targetAmount : 0;
            const cappedProgress = Math.min(1, progress);
            const excessProgress = Math.max(0, progress - 1);
            
            let isCollapsed = false;
            if (isCompleted) {
                isCollapsed = !expandedGoalIds.has(goal.id);
            } else {
                isCollapsed = compactGoalIds.has(goal.id);
            }
            
            const dashOffset = 351.86 - (351.86 * cappedProgress);
            const excessDashOffset = 351.86 - (351.86 * Math.min(1, excessProgress));
            
            let completionText = '';
            if (isCompleted) {
                if (shortfall < 0) {
                    completionText = `Goal Reached! <span class="text-xs text-emerald-300 block">(RM ${Math.abs(shortfall).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} Extra!)</span>`;
                } else {
                    completionText = 'Goal Reached! 🎉';
                }
            } else {
                completionText = `RM ${requiredMonthly.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} <span class="text-xs font-normal text-slate-400">/ mo</span>`;
            }
            
            const cardHtml = `
            <div class="premium-card relative group flex flex-col gap-4 transition-all hover:border-indigo-500/30 mb-4 break-inside-avoid">
                <div class="absolute top-3 right-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all z-10">
                    <button class="text-slate-500 hover:text-indigo-400" onclick="window.openGoalEditModal('${goal.id}')" title="Edit Goal">
                        <i data-lucide="edit-2" class="w-4 h-4"></i>
                    </button>
                    <button class="text-slate-500 hover:text-red-400" onclick="deleteGoal('${goal.id}')" title="Delete Goal">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                </div>
                
                <div class="flex flex-col md:flex-row gap-6">
                    <div class="relative flex-none w-32 h-32 mx-auto md:mx-0 flex items-center justify-center select-none">
                        <svg class="w-full h-full -rotate-90" width="128" height="128" viewBox="0 0 128 128">
                            <circle cx="64" cy="64" r="56" fill="none" class="stroke-white/10" stroke-width="12"></circle>
                            <circle cx="64" cy="64" r="56" fill="none" class="${isCompleted ? 'stroke-emerald-500' : 'stroke-indigo-500'} transition-all duration-300" stroke-width="12" stroke-dasharray="351.86" stroke-dashoffset="${dashOffset}" stroke-linecap="round"></circle>
                            ${excessProgress > 0 ? `<circle cx="64" cy="64" r="56" fill="none" class="stroke-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.8)] transition-all duration-300" stroke-width="12" stroke-dasharray="351.86" stroke-dashoffset="${excessDashOffset}" stroke-linecap="round"></circle>` : ''}
                        </svg>
                        <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                            <span class="text-xl font-bold ${excessProgress > 0 ? 'text-yellow-400' : (isCompleted ? 'text-emerald-400' : 'text-white')} progress-text-${goal.id}">${Math.round(progress * 100)}%</span>
                        </div>
                    </div>

                    <div class="flex-1 flex flex-col justify-center min-w-0">
                        <div class="flex items-center gap-2 mb-2 pr-6 relative">
                            ${isCompleted ? '<i data-lucide="check-circle-2" class="w-5 h-5 text-emerald-500"></i>' : '<i data-lucide="target" class="w-5 h-5 text-indigo-400"></i>'}
                            <h4 class="font-bold text-xl text-slate-100 truncate">${escapeHTML(goal.name)}</h4>
                            <button class="absolute right-0 top-0 text-slate-500 hover:text-indigo-400 transition-colors toggle-compact-btn" data-id="${goal.id}" title="Toggle Compact Mode">
                                <i data-lucide="${isCollapsed ? 'chevron-down' : 'chevron-up'}" class="w-5 h-5"></i>
                            </button>
                        </div>
                        
                        <div class="flex justify-between text-sm items-center mb-1">
                            <span class="text-slate-400">Target</span>
                            <span class="font-semibold text-white">RM ${goal.targetAmount.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
                        </div>
                        <div class="flex justify-between text-sm items-center ${excessProgress > 0 ? 'mb-1' : ''}">
                            <span class="text-slate-400">Saved</span>
                            <span class="font-semibold ${isCompleted ? 'text-emerald-400' : 'text-indigo-400'} current-amount-${goal.id}">RM ${currentAmt.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
                        </div>
                        ${excessProgress > 0 ? `
                        <div class="flex justify-between text-sm items-center">
                            <span class="text-slate-400">Extra</span>
                            <span class="font-semibold text-yellow-400">RM ${Math.abs(shortfall).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
                        </div>
                        ` : ''}
                        
                        <div class="bottom-section-${goal.id} ${isCollapsed ? 'hidden' : ''}">
                            <div class="flex flex-wrap gap-2 mt-4">
                                <button class="bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 text-sm py-1.5 px-4 rounded-lg font-medium transition-colors w-full sm:w-auto quick-deposit-btn" data-id="${goal.id}">
                                    <i data-lucide="plus" class="w-4 h-4 inline-block mr-1"></i> Add Money
                                </button>
                                <button class="bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-sm py-1.5 px-4 rounded-lg font-medium transition-colors w-full sm:w-auto quick-withdraw-btn" data-id="${goal.id}">
                                    <i data-lucide="minus" class="w-4 h-4 inline-block mr-1"></i> Withdraw
                                </button>
                            </div>
                            
                            <!-- Quick Deposit Tray -->
                            <div class="hidden mt-3 p-3 bg-black/40 border border-white/5 rounded-lg quick-deposit-tray" id="tray-${goal.id}">
                                <div class="flex gap-2 mb-2">
                                    <button class="flex-1 bg-white/5 hover:bg-white/10 text-xs py-1.5 rounded transition-colors deposit-chip" data-id="${goal.id}" data-amount="50">+50</button>
                                    <button class="flex-1 bg-white/5 hover:bg-white/10 text-xs py-1.5 rounded transition-colors deposit-chip" data-id="${goal.id}" data-amount="100">+100</button>
                                    <button class="flex-1 bg-white/5 hover:bg-white/10 text-xs py-1.5 rounded transition-colors deposit-chip" data-id="${goal.id}" data-amount="500">+500</button>
                                </div>
                                <div class="flex gap-2">
                                    <input type="number" step="0.01" class="flex-1 bg-transparent border-b border-white/20 px-2 py-1 text-sm text-white focus:border-indigo-500 outline-none" placeholder="Custom" id="custom-deposit-${goal.id}">
                                    <button class="bg-indigo-500 hover:bg-indigo-600 text-white text-xs px-3 py-1 rounded transition-colors custom-deposit-submit" data-id="${goal.id}" data-action="add">Add</button>
                                </div>
                            </div>

                            <!-- Quick Withdraw Tray -->
                            <div class="hidden mt-3 p-3 bg-black/40 border border-white/5 rounded-lg quick-withdraw-tray" id="withdraw-tray-${goal.id}">
                                <div class="flex gap-2 mb-2">
                                    <button class="flex-1 bg-white/5 hover:bg-white/10 text-xs py-1.5 rounded transition-colors deposit-chip" data-id="${goal.id}" data-amount="-50">-50</button>
                                    <button class="flex-1 bg-white/5 hover:bg-white/10 text-xs py-1.5 rounded transition-colors deposit-chip" data-id="${goal.id}" data-amount="-100">-100</button>
                                    <button class="flex-1 bg-white/5 hover:bg-white/10 text-xs py-1.5 rounded transition-colors deposit-chip" data-id="${goal.id}" data-amount="-500">-500</button>
                                </div>
                                <div class="flex gap-2">
                                    <input type="number" step="0.01" class="flex-1 bg-transparent border-b border-white/20 px-2 py-1 text-sm text-white focus:border-rose-500 outline-none" placeholder="Custom" id="custom-withdraw-${goal.id}">
                                    <button class="bg-rose-500 hover:bg-rose-600 text-white text-xs px-3 py-1 rounded transition-colors custom-deposit-submit" data-id="${goal.id}" data-action="withdraw">Withdraw</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="mt-2 pt-4 border-t border-white/5 bottom-section-${goal.id} ${isCollapsed ? 'hidden' : ''}">
                    <div class="h-20 relative w-full mb-2">
                        <canvas id="goalChart-${goal.id}"></canvas>
                    </div>
                    <div class="flex justify-between items-end mt-2">
                        <span class="text-xs text-slate-400">By ${targetMonth.toString().padStart(2, '0')}/${targetYear} ${monthsRemaining > 0 ? `(${monthsRemaining} mo)` : (monthsRemaining === 0 ? '(This mo)' : '(Overdue)')}</span>
                        <div class="text-sm font-bold ${isCompleted ? (excessProgress > 0 ? 'text-yellow-400 text-right' : 'text-emerald-400 text-right') : 'text-indigo-400'} req-monthly-${goal.id}">
                            ${completionText}
                        </div>
                    </div>
                </div>
            </div>`;
            
            if (isCompleted) completedHtml.push(cardHtml);
            else activeHtml.push(cardHtml);
        });
        
        list.innerHTML = activeHtml.join('');
        completedList.innerHTML = completedHtml.join('');
        
        if (completedHtml.length > 0) {
            if (heading) heading.classList.remove('hidden');
            if (heading) heading.classList.add('flex');
        } else {
            if (heading) heading.classList.remove('flex');
            if (heading) heading.classList.add('hidden');
        }
        
        renderMasterGoalChart();
        data.goals.forEach(goal => renderIndividualGoalChart(goal));
        
        // Use a container event delegation for toggle buttons since we split the lists
        const attachToggles = (container) => {
            container.querySelectorAll('.toggle-compact-btn').forEach(btn => {
                btn.onclick = (e) => {
                    const id = e.currentTarget.dataset.id;
                    const goal = data.goals.find(g => g.id === id);
                    if (!goal) return;
                    
                    const isCompleted = getGoalCurrentAmount(id) >= goal.targetAmount;
                    
                    if (isCompleted) {
                        if (expandedGoalIds.has(id)) expandedGoalIds.delete(id);
                        else expandedGoalIds.add(id);
                    } else {
                        if (compactGoalIds.has(id)) compactGoalIds.delete(id);
                        else compactGoalIds.add(id);
                    }
                    renderGoals();
                };
            });
            
            container.querySelectorAll('.quick-deposit-btn').forEach(btn => {
                btn.onclick = (e) => {
                    const id = e.currentTarget.dataset.id;
                    const tray = $('tray-' + id);
                    const withdrawTray = $('withdraw-tray-' + id);
                    if (withdrawTray && !withdrawTray.classList.contains('hidden')) withdrawTray.classList.add('hidden');
                    if (tray) tray.classList.toggle('hidden');
                };
            });
            
            container.querySelectorAll('.quick-withdraw-btn').forEach(btn => {
                btn.onclick = (e) => {
                    const id = e.currentTarget.dataset.id;
                    const tray = $('tray-' + id);
                    const withdrawTray = $('withdraw-tray-' + id);
                    if (tray && !tray.classList.contains('hidden')) tray.classList.add('hidden');
                    if (withdrawTray) withdrawTray.classList.toggle('hidden');
                };
            });
            
            container.querySelectorAll('.deposit-chip').forEach(btn => {
                btn.onclick = (e) => {
                    const id = e.currentTarget.dataset.id;
                    const amt = parseFloat(e.currentTarget.dataset.amount);
                    const goal = data.goals.find(g => g.id === id);
                    if (goal && amt !== 0 && !isNaN(amt)) {
                        const curMonth = monthKey(new Date());
                        data.entries.push({
                            id: 'entry-' + Date.now() + Math.random().toString(36).substr(2, 5),
                            item: amt > 0 ? `Goal Top-up: ${goal.name}` : `Goal Withdrawal: ${goal.name}`,
                            amount: amt,
                            dueDay: new Date().getDate(),
                            due: new Date().getDate(),
                            assignments: { [curMonth]: data.methods.length ? data.methods[0].id : 'method-cash' },
                            paid: { [curMonth]: true },
                            order: {},
                            type: 'one-off',
                            category: 'cat-savings',
                            startMonth: curMonth,
                            endMonth: curMonth,
                            isDaily: true,
                            goalId: goal.id
                        });
                        saveData();
                        renderGoals();
                    }
                };
            });
            
            container.querySelectorAll('.custom-deposit-submit').forEach(btn => {
                btn.onclick = (e) => {
                    const id = e.currentTarget.dataset.id;
                    const action = e.currentTarget.dataset.action || 'add';
                    const inputId = action === 'withdraw' ? 'custom-withdraw-' + id : 'custom-deposit-' + id;
                    const input = $(inputId);
                    let amt = parseFloat(input.value);
                    if (amt !== 0 && !isNaN(amt)) {
                        amt = Math.abs(amt) * (action === 'withdraw' ? -1 : 1);
                        const goal = data.goals.find(g => g.id === id);
                        if (goal) {
                            const curMonth = monthKey(new Date());
                            data.entries.push({
                                id: 'entry-' + Date.now() + Math.random().toString(36).substr(2, 5),
                                item: amt > 0 ? `Goal Top-up: ${goal.name}` : `Goal Withdrawal: ${goal.name}`,
                                amount: amt,
                                dueDay: new Date().getDate(),
                                due: new Date().getDate(),
                                assignments: { [curMonth]: data.methods.length ? data.methods[0].id : 'method-cash' },
                                paid: { [curMonth]: true },
                                order: {},
                                type: 'one-off',
                                category: 'cat-savings',
                                startMonth: curMonth,
                                endMonth: curMonth,
                                isDaily: true,
                                goalId: goal.id
                            });
                            saveData();
                            renderGoals();
                        }
                    }
                };
            });
        };
        
        attachToggles(list);
        attachToggles(completedList);

        
        refreshIcons();
    }
    
    window.deleteGoal = function(id) {
        if (confirm('Delete this goal and all its top-up entries?')) {
            data.goals = data.goals.filter(g => g.id !== id);
            data.entries = data.entries.filter(e => e.goalId !== id);
            saveData();
            renderGoals();
        }
    };


    
    // Initialize feature modules
    
    // Fallback load
    if (typeof loadData === 'function') {
        // Data is loaded on DOMContentLoaded below
    }
    // Initialize App
    window.addEventListener('DOMContentLoaded', () => {
        // Initialize Flatpickr for date inputs
        if (window.flatpickr) {
            flatpickr("#dailyLogDate", {
                dateFormat: "Y-m-d",
                theme: "dark",
                onChange: function(selectedDates, dateStr, instance) {
                    const [y, m, d] = dateStr.split('-');
                    if (y && m && d) window.currentDailyDate = new Date(y, parseInt(m)-1, d);
                    if (window.currentActiveView === 'view-daily') renderDailyLog();
                }
            });

            flatpickr(".month-picker", {
                plugins: [
                    new monthSelectPlugin({
                        shorthand: true,
                        dateFormat: "Y-m",
                        altFormat: "F Y",
                        theme: "dark"
                    })
                ]
            });
        }

        // Initialize active modal state mapping
        activeModal = null;
        
        loadData();
        
        // Migrate legacy global forecast settings to per-profile if it exists
        const globalSettings = localStorage.getItem('paytrack_forecast_settings');
        if (globalSettings) {
            profiles.forEach(p => {
                if (!localStorage.getItem(getSettingsKey(p.id))) {
                    localStorage.setItem(getSettingsKey(p.id), globalSettings);
                }
            });
            localStorage.removeItem('paytrack_forecast_settings');
        }

        initProfiles();
        initGoals();
        renderProfiles();
        initDailyLog();
        initRouter();
        triggerViewUpdate();
        
        // ============================
        // SIDEBAR COLLAPSE LOGIC
        // ============================
        const sidebarToggle = $('sidebarToggle');
        const sidebar = document.querySelector('.sidebar');
        const mainContent = document.querySelector('.main-content');
        
        // Restore saved preference
        if (localStorage.getItem('paytrack_sidebar_collapsed') === 'true') {
            if (window.innerWidth >= 768) {
                sidebar.classList.add('collapsed');
                mainContent.classList.add('expanded');
            }
        }
        
        if (sidebarToggle) {
            sidebarToggle.onclick = () => {
                if (sidebar.classList.contains('collapsed')) {
                    sidebar.classList.remove('collapsed');
                    mainContent.classList.remove('expanded');
                    localStorage.setItem('paytrack_sidebar_collapsed', 'false');
                } else {
                    sidebar.classList.add('collapsed');
                    mainContent.classList.add('expanded');
                    localStorage.setItem('paytrack_sidebar_collapsed', 'true');
                }
            };
        }
    });
})();
