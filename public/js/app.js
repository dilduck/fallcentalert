class FallcentAlertApp {
    constructor() {
        this.socket = null;
        this.products = [];
        this.settings = {
            enableNotifications: true,
            enableSound: true,
            superAlertRepeat: 3,
            electronicsAlertRepeat: 2,
            bestAlertRepeat: 2,
            keywordAlertRepeat: 3,
            keywords: [],
            sortBy: 'discount',
            sortOrder: 'desc',
            showOnlyNew: false
        };
        this.audioContext = null;
        this.currentFilters = {
            category: 'all',
            minDiscount: 0,
            maxPrice: null,
            searchTerm: ''
        };
        this.bannedProducts = new Set();
        this.seenProducts = new Set();
        this.stats = { total: 0, new: 0, super: 0, electronics: 0, best: 0, keyword: 0 };
        
        // 세션 관리 개선
        this.sessionId = this.generateSessionId();
        this.closedAlerts = new Set();
        this.sessionAlerts = {
            super: [],
            electronics: [],
            best: [],
            keyword: []
        };
    }

    generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    async init() {
        try {
            await this.loadSettings();
            this.initializeAudio();
            this.setupEventListeners();
            this.setupSocketConnection();
            this.setupAlertEventDelegation();
            this.updateLastUpdate();
            console.log('FallcentAlert 앱이 초기화되었습니다.', 'Session ID:', this.sessionId);
        } catch (error) {
            console.error('앱 초기화 중 오류:', error);
        }
    }

    // 이벤트 위임 개선 - 문서 레벨에서 처리
    setupAlertEventDelegation() {
        console.log('알림 이벤트 위임 설정 중...');
        
        // 기존 이벤트 리스너 제거 (중복 방지)
        document.removeEventListener('click', this.alertEventHandler);
        
        // 문서 레벨에서 이벤트 위임 처리
        this.alertEventHandler = (e) => {
            const button = e.target.closest('.alert-action-btn');
            if (!button) return;
            
            e.preventDefault();
            e.stopPropagation();
            
            const action = button.dataset.action;
            const alertId = button.dataset.alertId;
            const productId = button.dataset.productId;
            
            console.log(`알림 액션 실행: ${action}, Alert ID: ${alertId}, Product ID: ${productId}`);
            
            switch (action) {
                case 'open':
                    this.openProduct(button.dataset.productUrl, productId);
                    break;
                case 'close':
                    this.closeAlert(alertId, productId);
                    break;
                case 'ban':
                    this.banProduct(productId, button.dataset.productTitle);
                    break;
            }
        };
        
        document.addEventListener('click', this.alertEventHandler);
        console.log('알림 이벤트 위임이 설정되었습니다.');
    }

    setupEventListeners() {
        document.getElementById('settingsBtn').addEventListener('click', () => {
            this.openSettings();
        });

        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.manualCrawl();
        });

        document.getElementById('saveSettings').addEventListener('click', () => {
            this.saveSettings();
        });

        document.getElementById('resetSettings').addEventListener('click', () => {
            this.resetSettings();
        });

        document.getElementById('closeSettings').addEventListener('click', () => {
            this.closeSettings();
        });

        const sortSelect = document.getElementById('sortBy');
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                this.settings.sortBy = e.target.value;
                this.saveSettings();
                this.renderProducts();
            });
        }

        const sortOrderSelect = document.getElementById('sortOrder');
        if (sortOrderSelect) {
            sortOrderSelect.addEventListener('change', (e) => {
                this.settings.sortOrder = e.target.value;
                this.saveSettings();
                this.renderProducts();
            });
        }

        const showOnlyNewCheckbox = document.getElementById('showOnlyNew');
        if (showOnlyNewCheckbox) {
            showOnlyNewCheckbox.addEventListener('change', (e) => {
                this.settings.showOnlyNew = e.target.checked;
                this.saveSettings();
                this.renderProducts();
            });
        }

        // 필터 이벤트 리스너
        const categoryFilter = document.getElementById('categoryFilter');
        if (categoryFilter) {
            categoryFilter.addEventListener('change', (e) => {
                this.currentFilters.category = e.target.value;
                this.renderProducts();
            });
        }

        const minDiscountFilter = document.getElementById('minDiscountFilter');
        if (minDiscountFilter) {
            minDiscountFilter.addEventListener('input', (e) => {
                this.currentFilters.minDiscount = parseInt(e.target.value) || 0;
                this.renderProducts();
            });
        }

        const maxPriceFilter = document.getElementById('maxPriceFilter');
        if (maxPriceFilter) {
            maxPriceFilter.addEventListener('input', (e) => {
                this.currentFilters.maxPrice = parseInt(e.target.value) || null;
                this.renderProducts();
            });
        }

        const searchTermFilter = document.getElementById('searchTermFilter');
        if (searchTermFilter) {
            searchTermFilter.addEventListener('input', (e) => {
                this.currentFilters.searchTerm = e.target.value.toLowerCase();
                this.renderProducts();
            });
        }

        // 모달 외부 클릭 시 닫기
        document.getElementById('settingsModal').addEventListener('click', (e) => {
            if (e.target.id === 'settingsModal') {
                this.closeSettings();
            }
        });
    }

    setupSocketConnection() {
        this.socket = io();
        
        this.socket.emit('client-session-init', { sessionId: this.sessionId });

        this.socket.on('connect', () => {
            console.log('서버에 연결되었습니다.', 'Session ID:', this.sessionId);
            this.updateConnectionStatus(true);
        });

        this.socket.on('disconnect', () => {
            console.log('서버와의 연결이 끊어졌습니다.');
            this.updateConnectionStatus(false);
        });

        this.socket.on('products-update', (data) => {
            this.handleProductsUpdate(data);
        });

        this.socket.on('crawling-started', () => {
            this.showCrawlingStatus(true);
        });

        this.socket.on('crawling-finished', (data) => {
            this.showCrawlingStatus(false);
            if (data && data.results) {
                this.handleCrawlingResults(data.results);
            }
        });

        this.socket.on('settings-update', (settings) => {
            this.settings = { ...this.settings, ...settings };
            this.updateSettingsUI();
        });

        this.socket.on('stats-update', (stats) => {
            this.stats = stats;
            this.updateStats();
        });

        // 세션별 알림 처리
        this.socket.on('session-alerts', (alerts) => {
            console.log('세션별 알림 수신:', alerts);
            this.handleSessionAlerts(alerts);
        });

        this.socket.on('alert-closed', (alertId) => {
            console.log('알림 닫힘 확인:', alertId);
            this.closedAlerts.add(alertId);
            this.removeAlertFromUI(alertId);
        });

        this.socket.on('new-alert', (alert) => {
            if (!this.closedAlerts.has(alert.id)) {
                this.handleNewAlert(alert);
            }
        });
    }

    // 세션별 알림 처리
    handleSessionAlerts(alerts) {
        this.sessionAlerts = {
            super: alerts.filter(a => a.category === 'super'),
            electronics: alerts.filter(a => a.category === 'electronics'),
            best: alerts.filter(a => a.category === 'best'),
            keyword: alerts.filter(a => a.category === 'keyword')
        };
        this.renderSessionAlerts();
    }

    // 새로운 알림 처리
    handleNewAlert(alert) {
        if (this.closedAlerts.has(alert.id)) {
            return; // 이미 닫힌 알림은 무시
        }

        // 세션 알림에 추가
        if (this.sessionAlerts[alert.category]) {
            this.sessionAlerts[alert.category].push(alert);
        }

        this.renderSessionAlerts();
        this.playAlertSound(alert.category);
        
        if (this.settings.enableNotifications) {
            this.showBrowserNotification(alert);
        }
    }

    // 세션별 알림 렌더링
    renderSessionAlerts() {
        const sections = ['super', 'electronics', 'best', 'keyword'];
        
        sections.forEach(category => {
            const container = document.getElementById(`${category}Alerts`);
            if (!container) return;

            const alerts = this.sessionAlerts[category] || [];
            const filteredAlerts = alerts.filter(alert => !this.closedAlerts.has(alert.id));

            if (filteredAlerts.length === 0) {
                container.innerHTML = '<p class="text-gray-500 text-center py-4">알림 없음</p>';
                return;
            }

            container.innerHTML = filteredAlerts.map(alert => this.createAlertHTML(alert)).join('');
        });
    }

    createAlertHTML(alert) {
        return `
            <div class="alert-item bg-white rounded-lg shadow-md p-4 mb-3 border-l-4 border-blue-500" data-alert-id="${alert.id}">
                <div class="flex justify-between items-start">
                    <div class="flex-1">
                        <h4 class="font-semibold text-lg mb-2">${alert.title}</h4>
                        <div class="flex flex-wrap gap-2 mb-2">
                            <span class="px-2 py-1 bg-red-100 text-red-800 rounded text-sm font-medium">
                                ${alert.discount}% 할인
                            </span>
                            <span class="px-2 py-1 bg-green-100 text-green-800 rounded text-sm font-medium">
                                ${alert.price}원
                            </span>
                        </div>
                        <p class="text-gray-600 text-sm mb-3">${alert.description || ''}</p>
                        <p class="text-xs text-gray-500">${new Date(alert.timestamp).toLocaleString()}</p>
                    </div>
                    <div class="flex gap-2 ml-4">
                        <button class="alert-action-btn px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
                                data-action="open" 
                                data-product-url="${alert.url}" 
                                data-product-id="${alert.productId}"
                                data-alert-id="${alert.id}">
                            열기
                        </button>
                        <button class="alert-action-btn px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 text-sm"
                                data-action="close" 
                                data-alert-id="${alert.id}" 
                                data-product-id="${alert.productId}">
                            닫기
                        </button>
                        <button class="alert-action-btn px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm"
                                data-action="ban" 
                                data-product-id="${alert.productId}" 
                                data-product-title="${alert.title}"
                                data-alert-id="${alert.id}">
                            차단
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    openProduct(url, productId) {
        if (url) {
            window.open(url, '_blank');
            if (productId) {
                this.socket.emit('mark-as-seen', { productId });
            }
        }
    }

    closeAlert(alertId, productId) {
        console.log('알림 닫기:', alertId, productId);
        
        // 클라이언트 측에서 즉시 UI 업데이트
        this.closedAlerts.add(alertId);
        this.removeAlertFromUI(alertId);
        
        // 서버에 알림 닫기 요청
        this.socket.emit('close-alert', { 
            alertId, 
            productId, 
            sessionId: this.sessionId 
        });
    }

    removeAlertFromUI(alertId) {
        const alertElement = document.querySelector(`[data-alert-id="${alertId}"]`);
        if (alertElement) {
            alertElement.remove();
            
            // 알림이 없으면 "알림 없음" 메시지 표시
            const container = alertElement.closest('[id$="Alerts"]');
            if (container && container.children.length === 0) {
                container.innerHTML = '<p class="text-gray-500 text-center py-4">알림 없음</p>';
            }
        }
    }

    banProduct(productId, productTitle) {
        if (confirm(`"${productTitle}" 상품을 차단하시겠습니까?`)) {
            this.bannedProducts.add(productId);
            this.socket.emit('ban-product', { productId });
            
            // 해당 상품의 모든 알림 제거
            document.querySelectorAll(`[data-product-id="${productId}"]`).forEach(el => {
                const alertElement = el.closest('.alert-item');
                if (alertElement) {
                    const alertId = alertElement.dataset.alertId;
                    this.closedAlerts.add(alertId);
                    alertElement.remove();
                }
            });
            
            this.renderProducts();
        }
    }

    handleProductsUpdate(data) {
        this.products = data.products || [];
        this.settings = { ...this.settings, ...data.settings };
        this.stats = data.stats || this.stats;
        
        this.renderProducts();
        this.updateStats();
        this.updateSettingsUI();
        this.updateLastUpdate();
    }

    handleCrawlingResults(results) {
        if (results.newProducts && results.newProducts.length > 0) {
            console.log(`새로운 상품 ${results.newProducts.length}개 발견`);
        }
        
        if (results.alerts && results.alerts.length > 0) {
            results.alerts.forEach(alert => {
                if (!this.closedAlerts.has(alert.id)) {
                    this.handleNewAlert(alert);
                }
            });
        }
    }

    renderProducts() {
        const container = document.getElementById('productsContainer');
        if (!container) return;

        let filteredProducts = this.products.filter(product => {
            if (this.bannedProducts.has(product.id)) return false;
            if (this.settings.showOnlyNew && this.seenProducts.has(product.id)) return false;
            if (this.currentFilters.category !== 'all' && product.category !== this.currentFilters.category) return false;
            if (product.discount < this.currentFilters.minDiscount) return false;
            if (this.currentFilters.maxPrice && product.price > this.currentFilters.maxPrice) return false;
            if (this.currentFilters.searchTerm && !product.title.toLowerCase().includes(this.currentFilters.searchTerm)) return false;
            
            return true;
        });

        // 정렬
        filteredProducts.sort((a, b) => {
            const order = this.settings.sortOrder === 'desc' ? -1 : 1;
            switch (this.settings.sortBy) {
                case 'discount':
                    return (a.discount - b.discount) * order;
                case 'price':
                    return (a.price - b.price) * order;
                case 'title':
                    return a.title.localeCompare(b.title) * order;
                case 'timestamp':
                    return (new Date(a.timestamp) - new Date(b.timestamp)) * order;
                default:
                    return 0;
            }
        });

        if (filteredProducts.length === 0) {
            container.innerHTML = '<p class="text-gray-500 text-center py-8">표시할 상품이 없습니다.</p>';
            return;
        }

        container.innerHTML = filteredProducts.map(product => this.createProductHTML(product)).join('');
    }

    createProductHTML(product) {
        const isNew = !this.seenProducts.has(product.id);
        const categoryColors = {
            'super': 'border-red-500 bg-red-50',
            'electronics': 'border-blue-500 bg-blue-50',
            'best': 'border-green-500 bg-green-50',
            'keyword': 'border-purple-500 bg-purple-50'
        };

        return `
            <div class="product-item bg-white rounded-lg shadow-md p-4 border-l-4 ${categoryColors[product.category] || 'border-gray-300 bg-gray-50'} ${isNew ? 'ring-2 ring-yellow-400' : ''}">
                <div class="flex justify-between items-start">
                    <div class="flex-1">
                        <h3 class="font-semibold text-lg mb-2">${product.title}</h3>
                        <div class="flex flex-wrap gap-2 mb-2">
                            <span class="px-2 py-1 bg-red-100 text-red-800 rounded text-sm font-medium">
                                ${product.discount}% 할인
                            </span>
                            <span class="px-2 py-1 bg-green-100 text-green-800 rounded text-sm font-medium">
                                ${product.price.toLocaleString()}원
                            </span>
                            ${product.originalPrice ? `<span class="px-2 py-1 bg-gray-100 text-gray-600 rounded text-sm line-through">${product.originalPrice.toLocaleString()}원</span>` : ''}
                            ${isNew ? '<span class="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-sm font-medium">NEW</span>' : ''}
                        </div>
                        <p class="text-xs text-gray-500">${new Date(product.timestamp).toLocaleString()}</p>
                    </div>
                    <div class="flex gap-2 ml-4">
                        <button onclick="app.openProduct('${product.url}', '${product.id}')" 
                                class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
                            상품 보기
                        </button>
                        <button onclick="app.banProduct('${product.id}', '${product.title.replace(/'/g, "\\'")}')" 
                                class="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600">
                            차단
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    initializeAudio() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (error) {
            console.warn('오디오 컨텍스트 초기화 실패:', error);
        }
    }

    playAlertSound(category) {
        if (!this.settings.enableSound || !this.audioContext) return;

        const repeatCounts = {
            'super': this.settings.superAlertRepeat,
            'electronics': this.settings.electronicsAlertRepeat,
            'best': this.settings.bestAlertRepeat,
            'keyword': this.settings.keywordAlertRepeat
        };

        const repeatCount = repeatCounts[category] || 1;
        this.playBeepSequence(repeatCount);
    }

    playBeepSequence(count) {
        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                this.playBeep();
            }, i * 500);
        }
    }

    playBeep() {
        if (!this.audioContext) return;

        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.frequency.setValueAtTime(800, this.audioContext.currentTime);
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.2);

        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + 0.2);
    }

    showBrowserNotification(alert) {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(`${alert.category} 알림`, {
                body: `${alert.title} - ${alert.discount}% 할인`,
                icon: '/favicon.ico'
            });
        }
    }

    async requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            const permission = await Notification.requestPermission();
            return permission === 'granted';
        }
        return Notification.permission === 'granted';
    }

    manualCrawl() {
        this.socket.emit('manual-crawl');
        this.showCrawlingStatus(true);
    }

    showCrawlingStatus(isActive) {
        const button = document.getElementById('refreshBtn');
        if (button) {
            if (isActive) {
                button.textContent = '크롤링 중...';
                button.disabled = true;
                button.classList.add('opacity-50');
            } else {
                button.textContent = '새로고침';
                button.disabled = false;
                button.classList.remove('opacity-50');
            }
        }
    }

    updateConnectionStatus(isConnected) {
        const statusElement = document.getElementById('connectionStatus');
        if (statusElement) {
            statusElement.textContent = isConnected ? '연결됨' : '연결 끊김';
            statusElement.className = isConnected ? 'text-green-600' : 'text-red-600';
        }
    }

    updateStats() {
        const elements = {
            totalProducts: document.getElementById('totalProducts'),
            newProducts: document.getElementById('newProducts'),
            superAlerts: document.getElementById('superAlertsCount'),
            electronicsAlerts: document.getElementById('electronicsAlertsCount'),
            bestAlerts: document.getElementById('bestAlertsCount'),
            keywordAlerts: document.getElementById('keywordAlertsCount')
        };

        if (elements.totalProducts) elements.totalProducts.textContent = this.stats.total || 0;
        if (elements.newProducts) elements.newProducts.textContent = this.stats.new || 0;
        if (elements.superAlerts) elements.superAlerts.textContent = this.stats.super || 0;
        if (elements.electronicsAlerts) elements.electronicsAlerts.textContent = this.stats.electronics || 0;
        if (elements.bestAlerts) elements.bestAlerts.textContent = this.stats.best || 0;
        if (elements.keywordAlerts) elements.keywordAlerts.textContent = this.stats.keyword || 0;
    }

    updateLastUpdate() {
        const element = document.getElementById('lastUpdate');
        if (element) {
            element.textContent = new Date().toLocaleString();
        }
    }

    openSettings() {
        this.updateSettingsUI();
        document.getElementById('settingsModal').classList.remove('hidden');
        document.getElementById('settingsModal').classList.add('flex');
    }

    closeSettings() {
        document.getElementById('settingsModal').classList.add('hidden');
        document.getElementById('settingsModal').classList.remove('flex');
    }

    updateSettingsUI() {
        const elements = {
            enableNotifications: document.getElementById('enableNotifications'),
            enableSound: document.getElementById('enableSound'),
            superAlertRepeat: document.getElementById('superAlertRepeat'),
            electronicsAlertRepeat: document.getElementById('electronicsAlertRepeat'),
            bestAlertRepeat: document.getElementById('bestAlertRepeat'),
            keywordAlertRepeat: document.getElementById('keywordAlertRepeat'),
            keywords: document.getElementById('keywords'),
            sortBy: document.getElementById('sortBy'),
            sortOrder: document.getElementById('sortOrder'),
            showOnlyNew: document.getElementById('showOnlyNew')
        };

        if (elements.enableNotifications) elements.enableNotifications.checked = this.settings.enableNotifications;
        if (elements.enableSound) elements.enableSound.checked = this.settings.enableSound;
        if (elements.superAlertRepeat) elements.superAlertRepeat.value = this.settings.superAlertRepeat;
        if (elements.electronicsAlertRepeat) elements.electronicsAlertRepeat.value = this.settings.electronicsAlertRepeat;
        if (elements.bestAlertRepeat) elements.bestAlertRepeat.value = this.settings.bestAlertRepeat;
        if (elements.keywordAlertRepeat) elements.keywordAlertRepeat.value = this.settings.keywordAlertRepeat;
        if (elements.keywords) elements.keywords.value = (this.settings.keywords || []).join(', ');
        if (elements.sortBy) elements.sortBy.value = this.settings.sortBy;
        if (elements.sortOrder) elements.sortOrder.value = this.settings.sortOrder;
        if (elements.showOnlyNew) elements.showOnlyNew.checked = this.settings.showOnlyNew;
    }

    async saveSettings() {
        const formData = new FormData(document.getElementById('settingsForm'));
        
        this.settings = {
            enableNotifications: formData.get('enableNotifications') === 'on',
            enableSound: formData.get('enableSound') === 'on',
            superAlertRepeat: parseInt(formData.get('superAlertRepeat')) || 3,
            electronicsAlertRepeat: parseInt(formData.get('electronicsAlertRepeat')) || 2,
            bestAlertRepeat: parseInt(formData.get('bestAlertRepeat')) || 2,
            keywordAlertRepeat: parseInt(formData.get('keywordAlertRepeat')) || 3,
            keywords: formData.get('keywords').split(',').map(k => k.trim()).filter(k => k),
            sortBy: formData.get('sortBy') || 'discount',
            sortOrder: formData.get('sortOrder') || 'desc',
            showOnlyNew: formData.get('showOnlyNew') === 'on'
        };

        if (this.settings.enableNotifications) {
            await this.requestNotificationPermission();
        }

        localStorage.setItem('fallcentalert-settings', JSON.stringify(this.settings));
        this.socket.emit('update-settings', this.settings);
        
        this.closeSettings();
        this.renderProducts();
    }

    resetSettings() {
        if (confirm('설정을 초기화하시겠습니까?')) {
            localStorage.removeItem('fallcentalert-settings');
            this.settings = {
                enableNotifications: true,
                enableSound: true,
                superAlertRepeat: 3,
                electronicsAlertRepeat: 2,
                bestAlertRepeat: 2,
                keywordAlertRepeat: 3,
                keywords: [],
                sortBy: 'discount',
                sortOrder: 'desc',
                showOnlyNew: false
            };
            this.updateSettingsUI();
        }
    }

    async loadSettings() {
        try {
            const saved = localStorage.getItem('fallcentalert-settings');
            if (saved) {
                this.settings = { ...this.settings, ...JSON.parse(saved) };
            }
        } catch (error) {
            console.warn('설정 로드 실패:', error);
        }
    }
}

// 앱 초기화
const app = new FallcentAlertApp();

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});