const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const cron = require('node-cron');

const CrawlerService = require('./services/crawler-service');
const AlertService = require('./services/alert-service');
const StorageService = require('./services/storage-service');
const SessionManager = require('./services/session-manager');

class FallcentAlert {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = socketIo(this.server);
        
        // 서비스 초기화
        this.crawlerService = new CrawlerService();
        this.alertService = new AlertService();
        this.storageService = new StorageService();
        this.sessionManager = new SessionManager(); // 새로운 세션 매니저
        
        this.products = [];
        this.settings = {
            crawlingInterval: 5,
            keywords: [],
            enableNotifications: true,
            enableSound: true,
            superAlertRepeat: 3,
            electronicsAlertRepeat: 2,
            bestAlertRepeat: 2,
            keywordAlertRepeat: 3
        };
        
        this.isRunning = false;
        this.crawlingJob = null;
        
        this.setupMiddleware();
        this.setupRoutes();
        this.setupSocketEvents();
        this.setupCleanupInterval();
    }

    setupMiddleware() {
        this.app.use(express.static(path.join(__dirname, '../public')));
        this.app.use(express.json());
        
        // CORS 설정
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
            next();
        });
    }

    setupRoutes() {
        // API 라우트
        this.app.get('/api/products', (req, res) => {
            res.json({
                products: this.products,
                settings: this.settings,
                stats: this.getStats()
            });
        });

        this.app.get('/api/settings', (req, res) => {
            res.json(this.settings);
        });

        this.app.post('/api/settings', (req, res) => {
            this.settings = { ...this.settings, ...req.body };
            this.storageService.saveSettings(this.settings);
            
            // 모든 클라이언트에 설정 업데이트 브로드캐스트
            this.sessionManager.broadcastToAllSessions('settings-update', this.settings);
            
            res.json(this.settings);
        });

        // 메인 페이지
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(__dirname, '../public/index.html'));
        });

        // 세션 관리 통계 (개발용)
        this.app.get('/api/sessions', (req, res) => {
            res.json(this.sessionManager.getStats());
        });
    }

    setupSocketEvents() {
        this.io.on('connection', (socket) => {
            console.log('새로운 클라이언트 연결:', socket.id);
            
            // 클라이언트에서 세션 초기화 요청 처리
            socket.on('client-session-init', (data) => {
                const sessionId = data.sessionId || this.sessionManager.generateSessionId();
                socket.sessionId = sessionId;
                
                // 세션 초기화
                this.sessionManager.initializeSession(sessionId, socket);
                
                console.log(`클라이언트 세션 초기화: ${sessionId}`);
                
                // 초기 데이터 전송
                socket.emit('products-update', {
                    products: this.products,
                    settings: this.settings,
                    stats: this.getStats()
                });
            });

            // 수동 크롤링 요청
            socket.on('manual-crawl', () => {
                console.log('수동 크롤링 요청 받음');
                this.performCrawling(true);
            });

            // 상품 확인 처리
            socket.on('mark-as-seen', (data) => {
                if (socket.sessionId) {
                    this.sessionManager.updateSessionActivity(socket.sessionId);
                }
                console.log('상품 확인됨:', data.productId);
            });

            // 상품 차단 처리
            socket.on('ban-product', (data) => {
                if (socket.sessionId) {
                    this.sessionManager.updateSessionActivity(socket.sessionId);
                }
                
                console.log('상품 차단:', data.productId);
                
                // 해당 상품 제거
                this.products = this.products.filter(p => p.id !== data.productId);
                
                // 모든 클라이언트에 업데이트 브로드캐스트
                this.sessionManager.broadcastToAllSessions('products-update', {
                    products: this.products,
                    settings: this.settings,
                    stats: this.getStats()
                });
            });

            // 세션별 알림 닫기 처리
            socket.on('close-alert', (data) => {
                const { alertId, sessionId } = data;
                
                if (!sessionId || !this.sessionManager.hasSession(sessionId)) {
                    console.warn('유효하지 않은 세션 ID:', sessionId);
                    return;
                }
                
                // 해당 세션에서만 알림 닫기
                const success = this.sessionManager.closeAlertForSession(sessionId, alertId);
                
                if (success) {
                    console.log(`세션 ${sessionId}에서 알림 ${alertId} 닫기 완료`);
                } else {
                    console.warn(`알림 닫기 실패: ${alertId}, 세션: ${sessionId}`);
                }
            });

            // 설정 업데이트
            socket.on('update-settings', (newSettings) => {
                if (socket.sessionId) {
                    this.sessionManager.updateSessionActivity(socket.sessionId);
                }
                
                this.settings = { ...this.settings, ...newSettings };
                this.storageService.saveSettings(this.settings);
                
                // 모든 클라이언트에 설정 업데이트 브로드캐스트
                this.sessionManager.broadcastToAllSessions('settings-update', this.settings);
                
                console.log('설정 업데이트됨:', newSettings);
            });

            // 연결 해제 처리
            socket.on('disconnect', () => {
                console.log('클라이언트 연결 해제:', socket.id);
                
                if (socket.sessionId) {
                    this.sessionManager.cleanupSession(socket.sessionId);
                }
            });
        });
    }

    // 정리 작업 스케줄 설정
    setupCleanupInterval() {
        // 매 시간마다 비활성 세션 정리
        cron.schedule('0 * * * *', () => {
            console.log('비활성 세션 정리 작업 시작');
            this.sessionManager.cleanupInactiveSessions();
        });
    }

    async performCrawling(isManual = false) {
        if (this.isRunning && !isManual) {
            console.log('크롤링이 이미 실행 중입니다.');
            return;
        }

        try {
            this.isRunning = true;
            
            // 모든 클라이언트에 크롤링 시작 알림
            this.sessionManager.broadcastToAllSessions('crawling-started', {});
            
            console.log('크롤링 시작...');
            const crawlingResults = await this.crawlerService.crawl();
            
            if (crawlingResults && crawlingResults.length > 0) {
                const newProducts = this.processNewProducts(crawlingResults);
                const alerts = this.generateAlerts(newProducts);
                
                // 통계 업데이트
                const stats = this.getStats();
                
                // 모든 클라이언트에 크롤링 완료 및 업데이트 브로드캐스트
                this.sessionManager.broadcastToAllSessions('crawling-finished', {
                    results: {
                        newProducts,
                        alerts,
                        total: crawlingResults.length
                    }
                });
                
                this.sessionManager.broadcastToAllSessions('products-update', {
                    products: this.products,
                    settings: this.settings,
                    stats
                });
                
                console.log(`크롤링 완료: 총 ${crawlingResults.length}개 상품, 새로운 상품 ${newProducts.length}개`);
            } else {
                this.sessionManager.broadcastToAllSessions('crawling-finished', {
                    results: { newProducts: [], alerts: [], total: 0 }
                });
                console.log('크롤링 완료: 새로운 상품 없음');
            }
            
        } catch (error) {
            console.error('크롤링 중 오류 발생:', error);
            this.sessionManager.broadcastToAllSessions('crawling-finished', {
                error: error.message
            });
        } finally {
            this.isRunning = false;
        }
    }

    processNewProducts(crawlingResults) {
        const newProducts = [];
        const existingIds = new Set(this.products.map(p => p.id));
        
        crawlingResults.forEach(product => {
            if (!existingIds.has(product.id)) {
                product.timestamp = new Date().toISOString();
                this.products.push(product);
                newProducts.push(product);
            }
        });
        
        // 오래된 상품 제거 (최대 1000개 유지)
        if (this.products.length > 1000) {
            this.products = this.products.slice(-1000);
        }
        
        return newProducts;
    }

    generateAlerts(newProducts) {
        const alerts = [];
        
        newProducts.forEach(product => {
            const alertData = this.alertService.checkProduct(product, this.settings);
            
            if (alertData) {
                // 세션 매니저를 통해 글로벌 알림 추가
                const alertId = this.sessionManager.addGlobalAlert({
                    category: alertData.category,
                    title: product.title,
                    description: alertData.message,
                    discount: product.discount,
                    price: product.price,
                    url: product.url,
                    productId: product.id
                });
                
                alerts.push({
                    id: alertId,
                    category: alertData.category,
                    product,
                    message: alertData.message
                });
            }
        });
        
        return alerts;
    }

    getStats() {
        const stats = {
            total: this.products.length,
            new: this.products.filter(p => {
                const productTime = new Date(p.timestamp);
                const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
                return productTime > oneHourAgo;
            }).length,
            super: 0,
            electronics: 0,
            best: 0,
            keyword: 0
        };
        
        // 카테고리별 통계
        this.products.forEach(product => {
            if (product.category === 'super') stats.super++;
            else if (product.category === 'electronics') stats.electronics++;
            else if (product.category === 'best') stats.best++;
            else if (product.category === 'keyword') stats.keyword++;
        });
        
        return stats;
    }

    async start(port = 3000) {
        try {
            // 저장된 설정 로드
            const savedSettings = await this.storageService.loadSettings();
            if (savedSettings) {
                this.settings = { ...this.settings, ...savedSettings };
            }
            
            // 저장된 상품 로드
            const savedProducts = await this.storageService.loadProducts();
            if (savedProducts && savedProducts.length > 0) {
                this.products = savedProducts;
                console.log(`저장된 상품 ${savedProducts.length}개 로드됨`);
            }
            
            // 서버 시작
            this.server.listen(port, () => {
                console.log(`Fallcent Alert 서버가 포트 ${port}에서 실행 중입니다.`);
                console.log(`http://localhost:${port} 에서 접속 가능합니다.`);
            });
            
            // 크롤링 스케줄 설정
            this.scheduleCrawling();
            
            // 초기 크롤링 실행
            setTimeout(() => {
                this.performCrawling();
            }, 5000);
            
        } catch (error) {
            console.error('서버 시작 중 오류 발생:', error);
        }
    }

    scheduleCrawling() {
        // 기존 스케줄 정리
        if (this.crawlingJob) {
            this.crawlingJob.destroy();
        }
        
        // 설정된 간격으로 크롤링 스케줄 설정
        const cronPattern = `*/${this.settings.crawlingInterval} * * * *`;
        
        this.crawlingJob = cron.schedule(cronPattern, () => {
            this.performCrawling();
        }, {
            scheduled: true
        });
        
        console.log(`크롤링 스케줄 설정: ${this.settings.crawlingInterval}분 간격`);
    }

    async stop() {
        console.log('서버 종료 중...');
        
        // 크롤링 작업 정리
        if (this.crawlingJob) {
            this.crawlingJob.destroy();
        }
        
        // 현재 상품 저장
        await this.storageService.saveProducts(this.products);
        await this.storageService.saveSettings(this.settings);
        
        // 모든 세션 정리
        this.sessionManager.sessions.clear();
        
        // 서버 종료
        this.server.close(() => {
            console.log('서버가 정상적으로 종료되었습니다.');
        });
    }
}

// 서버 인스턴스 생성 및 시작
const fallcentAlert = new FallcentAlert();

// 종료 신호 처리
process.on('SIGTERM', () => {
    console.log('SIGTERM 신호 받음');
    fallcentAlert.stop();
});

process.on('SIGINT', () => {
    console.log('SIGINT 신호 받음');
    fallcentAlert.stop();
});

// 처리되지 않은 예외 처리
process.on('uncaughtException', (error) => {
    console.error('처리되지 않은 예외:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('처리되지 않은 Promise 거부:', reason);
});

// 포트 설정 및 서버 시작
const port = process.env.PORT || 3000;
fallcentAlert.start(port);

module.exports = FallcentAlert;