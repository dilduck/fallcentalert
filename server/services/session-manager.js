class SessionManager {
    constructor() {
        this.sessions = new Map();
        this.globalAlerts = [];
        this.alertIdCounter = 0;
    }

    generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    generateAlertId() {
        return 'alert_' + (++this.alertIdCounter) + '_' + Date.now();
    }

    initializeSession(sessionId, socket) {
        console.log(`세션 초기화: ${sessionId}`);
        
        this.sessions.set(sessionId, {
            socket,
            closedAlerts: new Set(),
            createdAt: Date.now(),
            lastActivity: Date.now()
        });

        // 세션에 기존 글로벌 알림 전송 (닫지 않은 알림만)
        const sessionAlerts = this.getSessionAlerts(sessionId);
        socket.emit('session-alerts', sessionAlerts);

        return sessionId;
    }

    closeAlertForSession(sessionId, alertId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.closedAlerts.add(alertId);
            session.lastActivity = Date.now();
            console.log(`세션 ${sessionId}에서 알림 ${alertId} 닫기`);
            
            // 해당 세션에만 알림 닫기 확인 전송
            session.socket.emit('alert-closed', alertId);
            return true;
        }
        return false;
    }

    getSessionAlerts(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            console.warn(`세션을 찾을 수 없음: ${sessionId}`);
            return [];
        }

        // 해당 세션에서 닫지 않은 알림만 반환
        const filteredAlerts = this.globalAlerts.filter(alert => 
            !session.closedAlerts.has(alert.id)
        );

        console.log(`세션 ${sessionId}의 알림 개수: ${filteredAlerts.length}`);
        return filteredAlerts;
    }

    addGlobalAlert(alert) {
        // 알림 ID 생성
        alert.id = this.generateAlertId();
        alert.timestamp = new Date().toISOString();
        
        this.globalAlerts.push(alert);
        console.log(`글로벌 알림 추가: ${alert.id} - ${alert.title}`);

        // 모든 세션에 새로운 알림 전송 (각 세션에서 닫지 않은 경우에만)
        this.sessions.forEach((session, sessionId) => {
            if (!session.closedAlerts.has(alert.id)) {
                session.socket.emit('new-alert', alert);
                console.log(`세션 ${sessionId}에 새로운 알림 전송: ${alert.id}`);
            }
        });

        // 오래된 알림 정리 (최대 100개 유지)
        if (this.globalAlerts.length > 100) {
            this.globalAlerts = this.globalAlerts.slice(-100);
        }

        return alert.id;
    }

    removeAlert(alertId) {
        this.globalAlerts = this.globalAlerts.filter(alert => alert.id !== alertId);
        console.log(`글로벌 알림 제거: ${alertId}`);
    }

    cleanupSession(sessionId) {
        if (this.sessions.has(sessionId)) {
            console.log(`세션 정리: ${sessionId}`);
            this.sessions.delete(sessionId);
        }
    }

    // 비활성 세션 정리 (1시간 이상 비활성)
    cleanupInactiveSessions() {
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        let cleanedCount = 0;

        this.sessions.forEach((session, sessionId) => {
            if (session.lastActivity < oneHourAgo) {
                this.sessions.delete(sessionId);
                cleanedCount++;
                console.log(`비활성 세션 정리: ${sessionId}`);
            }
        });

        if (cleanedCount > 0) {
            console.log(`총 ${cleanedCount}개의 비활성 세션이 정리되었습니다.`);
        }
    }

    // 통계 정보
    getStats() {
        return {
            activeSessions: this.sessions.size,
            totalAlerts: this.globalAlerts.length,
            sessions: Array.from(this.sessions.entries()).map(([sessionId, session]) => ({
                sessionId,
                closedAlertsCount: session.closedAlerts.size,
                createdAt: session.createdAt,
                lastActivity: session.lastActivity
            }))
        };
    }

    // 세션 존재 확인
    hasSession(sessionId) {
        return this.sessions.has(sessionId);
    }

    // 세션 활동 업데이트
    updateSessionActivity(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.lastActivity = Date.now();
        }
    }

    // 모든 세션에 브로드캐스트
    broadcastToAllSessions(event, data) {
        this.sessions.forEach((session, sessionId) => {
            session.socket.emit(event, data);
        });
    }

    // 특정 세션에 데이터 전송
    sendToSession(sessionId, event, data) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.socket.emit(event, data);
            this.updateSessionActivity(sessionId);
            return true;
        }
        return false;
    }
}

module.exports = SessionManager;