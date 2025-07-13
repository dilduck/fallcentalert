# Fallcent Alert - 세션별 독립 알림 시스템

실시간 폴센트 할인 정보를 크롤링하고 사용자별로 독립적인 알림을 제공하는 웹 애플리케이션입니다.

## 🚀 주요 기능

### ✅ 해결된 문제들
- **세션별 독립적인 알림 관리**: 각 사용자(세션)마다 독립적인 알림 상태 유지
- **이벤트 위임 개선**: 페이지 로딩 후에도 동적 버튼들이 정상 작동
- **메모리 누수 방지**: 세션 정리 및 알림 제한 시스템 구현
- **실시간 상태 동기화**: 한 세션에서 닫은 알림이 다른 세션에 영향 없음

### 📋 핵심 기능
- 실시간 폴센트 웹사이트 크롤링
- 4가지 알림 카테고리
  - 초특가 (49% 이상 할인)
  - 가전/디지털
  - 베스트 딜 (20% 이상 할인)
  - 키워드 매칭
- 브라우저 알림 및 사운드 알림
- 세션별 독립적인 알림 상태 관리
- 상품 필터링 및 정렬
- 사용자 맞춤 설정

## 🔧 기술 스택

- **Backend**: Node.js, Express, Socket.IO
- **Frontend**: HTML5, TailwindCSS, JavaScript (ES6+)
- **크롤링**: Puppeteer, Cheerio
- **스케줄링**: node-cron
- **실시간 통신**: WebSocket

## 📂 프로젝트 구조

```
fallcentalert/
├── server/
│   ├── app.js                    # 메인 서버 애플리케이션
│   └── services/
│       ├── crawler-service.js    # 웹 크롤링 서비스
│       ├── alert-service.js      # 알림 처리 서비스
│       ├── storage-service.js    # 데이터 저장 서비스
│       └── session-manager.js    # 세션 관리 서비스 (신규)
├── public/
│   ├── index.html               # 메인 페이지
│   └── js/
│       └── app.js              # 클라이언트 JavaScript
└── package.json
```

## 🚀 설치 및 실행

1. **의존성 설치**
```bash
npm install
```

2. **개발 모드 실행**
```bash
npm run dev
```

3. **프로덕션 모드 실행**
```bash
npm start
```

4. **브라우저에서 접속**
```
http://localhost:3000
```

## 🔄 변경사항 (v1.1.0)

### 🆕 새로운 기능
- **SessionManager 클래스**: 세션별 알림 상태 관리
- **개선된 이벤트 위임**: 문서 레벨에서의 안정적인 이벤트 처리
- **세션 정리 시스템**: 비활성 세션 자동 정리 (1시간 후)
- **실시간 상태 동기화**: 세션별 독립적인 알림 상태

### 🔧 수정된 기능
- 클라이언트 측 이벤트 위임 로직 개선
- 서버 측 세션 관리 시스템 도입
- 알림 ID 생성 및 관리 체계 개선
- 메모리 사용량 최적화

### 🐛 버그 수정
- 페이지 로딩 후 시간이 지나도 닫기 버튼 정상 작동
- 세션별로 독립적인 알림 표시 (다른 세션에 영향 없음)
- 동적 생성 요소의 이벤트 처리 안정화
- 메모리 누수 방지

## 📊 세션 관리

### 세션 생성
- 각 클라이언트 연결시 고유한 세션 ID 생성
- 세션별 독립적인 알림 상태 유지

### 세션 정리
- 1시간 이상 비활성 세션 자동 정리
- 연결 해제시 즉시 세션 정리
- 최대 알림 개수 제한 (100개)

### API 엔드포인트
- `GET /api/sessions`: 현재 활성 세션 통계
- `GET /api/products`: 상품 및 설정 정보
- `POST /api/settings`: 설정 업데이트

## 🔧 설정

### 알림 설정
- 브라우저 알림 활성화/비활성화
- 사운드 알림 활성화/비활성화
- 카테고리별 알림 반복 횟수 설정
- 키워드 매칭 설정

### 크롤링 설정
- 크롤링 간격 설정 (분 단위)
- 수동 크롤링 실행

## 🔍 모니터링

### 통계 정보
- 총 상품 수
- 새로운 상품 수
- 카테고리별 알림 수
- 활성 세션 수

### 로그
- 세션 생성/종료 로그
- 알림 생성/닫기 로그
- 크롤링 결과 로그

## 🤝 기여하기

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 라이선스

MIT License - 자세한 내용은 [LICENSE](LICENSE) 파일을 참조하세요.

## 📞 지원

문제가 발생하거나 기능 요청이 있으시면 [Issues](https://github.com/dilduck/fallcentalert/issues)에 등록해주세요.