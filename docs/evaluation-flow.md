# 신규 평가 흐름 전체 실행 가이드 (Postman)

직원 등록부터 직원 의견 제출까지, Employee 기반 신규 흐름을 처음부터 끝까지 따라 하는 순서입니다.
요청은 위에서부터 차례대로 실행하면 되고, 각 단계의 응답 값을 다음 단계에서 사용합니다.

> 레거시 흐름(`/evaluation/*` 단수, Applicant·Employment)과는 별개입니다. 이 문서는 신규 API만 다룹니다.

---

## 0. 준비

### Postman 변수

| 변수 | 값 | 채우는 시점 |
|---|---|---|
| `baseUrl` | 로컬 `http://localhost:3000/api/v1` / 서버 `https://api.genicheck.com/api/v1` | 처음 |
| `ceoToken` | 대표 accessToken | 1단계 |
| `templateId` | 질문 템플릿 ID | 2단계 |
| `employeeId` | 직원 ID | 3단계 |
| `declarationToken` | 자기선언 링크 토큰 | 4단계 |
| `evaluationId` | 평가 ID | 6단계 |
| `selfToken` | 자기평가 링크 토큰 | 6단계 |
| `resultToken` | 평가 결과 링크 토큰 | 8단계 |

- 대표 API는 Headers에 `Authorization: Bearer {{ceoToken}}`를 넣습니다.
- 직원 API(토큰 URL)는 인증 헤더가 필요 없습니다.

### 직원 링크 토큰을 얻는 방법

직원용 링크 토큰은 **메일로만** 전달되고, DB에는 해시만 저장되어 조회할 수 없습니다.

- **SMTP 설정됨(서버):** 직원 이메일로 받은 링크의 마지막 경로(64자리)가 토큰입니다.
- **SMTP 미설정(로컬, `SMTP_USER` 비움):** 메일 대신 서버 로그에 링크가 찍힙니다.
  ```
  [MailService] [SMTP 미설정] [GeniCheck] 입사 자기선언 작성 요청 → minjun@example.com: http://localhost:5180/verification/self-declare/<토큰>
  ```

| 메일 | 링크 경로 | 사용하는 API |
|---|---|---|
| 입사 자기선언 작성 요청 | `/verification/self-declare/<토큰>` | 4·5단계 |
| 퇴사 자기평가 작성 요청 | `/evaluation/self/<토큰>` | 6·7단계 |
| 평가 결과 안내 | `/evaluation/result/<토큰>` | 8·9단계 |

### 응답 형식

- 성공: `{ "success": true, "message": "...", "data": { ... } }` → 아래 응답 예시는 `data`만 적었습니다.
- 실패: `{ "success": false, "code": "ERROR_CODE", "message": "...", "details": { ... } }`
- 날짜는 UTC(ISO 8601)로 응답합니다. 마감 `...T14:59:59.000Z`는 KST `23:59:59`입니다.

---

## 1. 대표 로그인 (CEO JWT 발급)

가입된 대표 계정이 필요합니다(기존 회원가입 흐름).

**1-1. 로그인 1단계**
```
POST {{baseUrl}}/auth/company/login
```
```json
{ "email": "ceo@company.com", "password": "Password1!" }
```
→ `data.tempToken`. 대표 이메일로 OTP 6자리가 발송됩니다.

> 로컬에서 SMTP가 없으면 OTP는 DB에서 확인합니다.
> `SELECT code FROM otp_verifications WHERE email = 'ceo@company.com' AND purpose = 'ceo_login' ORDER BY "createdAt" DESC LIMIT 1;`

**1-2. OTP 인증**
```
POST {{baseUrl}}/auth/company/otp/verify
```
```json
{ "tempToken": "<1-1의 tempToken>", "otpCode": "123456" }
```
→ `data.accessToken`을 `ceoToken`에 저장합니다.

---

## 2. 질문 템플릿 만들기 (대표)

```
POST {{baseUrl}}/question-templates
```
```json
{
  "name": "개발직군 입사 자기선언",
  "description": "개발직군 공통 질문",
  "questions": [
    { "order": 1, "type": "SCORE", "text": "업무 책임감을 평가해 주세요.", "required": true, "scoreMin": 1, "scoreMax": 10, "evaluationEnabled": true },
    { "order": 2, "type": "SINGLE_CHOICE", "text": "선호 업무 방식은 무엇인가요?", "required": true, "options": ["개인 집중", "팀 협업"], "evaluationEnabled": false },
    { "order": 3, "type": "TEXT", "text": "주요 성과를 작성해 주세요.", "required": true, "maxLength": 500, "evaluationEnabled": true }
  ]
}
```
→ `{ templateId, version: 1, questionCount: 3, status: "ACTIVE" }` · `templateId` 저장

- `evaluationEnabled: true`인 질문만 퇴사 평가 항목이 됩니다(위 예시에서는 1·3번).
- 확인: `GET {{baseUrl}}/question-templates`, `GET {{baseUrl}}/question-templates/{{templateId}}`

---

## 3. 직원 등록 (대표)

```
POST {{baseUrl}}/employees
```
```json
{
  "name": "김민준",
  "email": "minjun@example.com",
  "phone": "010-5555-6666",
  "department": "프론트엔드 개발팀",
  "position": "과장",
  "employmentStartDate": "2025-01-02"
}
```
→ `{ employeeId, employmentStatus: "EMPLOYED", declarationStatus: "NOT_SENT" }` · `employeeId` 저장

- 이메일은 소문자·공백 제거 후 저장되며, 같은 기업에 같은 이메일이 있으면 409 `EMPLOYEE_ALREADY_EXISTS`입니다.
- 확인: `GET {{baseUrl}}/employees`, `GET {{baseUrl}}/employees/{{employeeId}}`

---

## 4. 자기선언 질문지 발송 → 직원 조회

**4-1. 발송 (대표)**
```
POST {{baseUrl}}/employees/{{employeeId}}/declarations
```
```json
{ "templateId": "{{templateId}}", "sendChannel": "EMAIL" }
```
→ `{ declarationId, templateVersion, questionCount, status: "SENT", linkExpiresAt, linkSent }`

- 메일(또는 서버 로그)의 `/verification/self-declare/<토큰>`에서 토큰을 `declarationToken`에 저장합니다.
- 링크는 발송일 + 7일 KST 23:59:59까지 유효합니다.

**4-2. 질문지 조회 (직원, 인증 없음)**
```
GET {{baseUrl}}/declarations/forms/{{declarationToken}}
```
→ `questions[]`(각 `questionId`), 선택형의 `options[{ optionId, label }]`, `consentVersion`

- 조회만으로는 링크가 소비되지 않습니다.

---

## 5. 자기선언 제출 (직원)

```
POST {{baseUrl}}/declarations/forms/{{declarationToken}}/submit
```
```json
{
  "answers": [
    { "questionId": "<1번 questionId>", "answerScore": 8 },
    { "questionId": "<2번 questionId>", "answerOptionId": "<2번 options[1].optionId>" },
    { "questionId": "<3번 questionId>", "answerText": "React 성능 개선을 진행했습니다." }
  ],
  "consents": {
    "evaluationAgreed": true,
    "dataAccessAgreed": true,
    "evidenceRetentionAgreed": true,
    "consentVersion": "<4-2의 consentVersion>"
  }
}
```
→ `{ declarationId, status: "SUBMITTED", submittedAt, linkConsumed: true }`

- 동의 값은 `true`/`false` boolean만 허용합니다(문자열 `"true"`는 400).
- 확인 (대표): `GET {{baseUrl}}/declarations/{{employeeId}}`

---

## 6. 퇴사 등록 (대표) → 자기평가 링크

```
POST {{baseUrl}}/employment/resign
```
```json
{ "employeeId": "{{employeeId}}", "resignationDate": "2026-10-09", "selfEvaluationSendChannel": "EMAIL" }
```
→ `{ employmentId, evaluationId, employmentStatus: "RESIGNED", evaluationStatus: "SELF_PENDING", selfEvaluationDueAt, ceoEvaluationDueAt, linkSent }`

- `evaluationId` 저장. 메일(또는 로그)의 `/evaluation/self/<토큰>`을 `selfToken`에 저장합니다.
- 마감: 자기평가 = 퇴사일 + 3일, 대표 검증 = 퇴사일 + 15일 (KST 23:59:59)
- **시연 팁:** 퇴사일을 오늘로 두세요. 과거 날짜면 마감이 이미 지나 링크가 만료(410)됩니다.

---

## 7. 자기평가 (직원)

**7-1. 폼 조회**
```
GET {{baseUrl}}/evaluations/self/{{selfToken}}
```
→ `items[{ questionId, question, declarationAnswer, selfScore: null }]` (평가 대상 질문만)

**7-2. 제출**
```
POST {{baseUrl}}/evaluations/self/{{selfToken}}/submit
```
```json
{
  "items": [
    { "questionId": "<items[0].questionId>", "selfScore": 8 },
    { "questionId": "<items[1].questionId>", "selfScore": 7 }
  ]
}
```
→ `{ evaluationId, status: "CEO_PENDING", submittedAt, ceoEvaluationDueAt }`

- 모든 항목을 한 번씩, 1~10 정수로 보냅니다. 서술형 필드는 없습니다.
- 자기평가 기한이 지나면 평가는 `SELF_EXPIRED`가 되고, 대표 검증은 자기점수 없이 진행할 수 있습니다.

---

## 8. 대표 검증 (대표) → 결과 링크

**8-1. 검증 폼 조회**
```
GET {{baseUrl}}/evaluations/{{evaluationId}}/ceo
```
→ `items[{ questionId, question, declarationAnswer, selfScore, ceoScore: null }]`, `commonCompetencies[6]`

**8-2. 검증 제출**
```
POST {{baseUrl}}/evaluations/{{evaluationId}}/ceo
```
```json
{
  "items": [
    { "questionId": "<items[0].questionId>", "ceoScore": 7 },
    { "questionId": "<items[1].questionId>", "ceoScore": 8 }
  ],
  "commonCompetencies": [
    { "key": "TRUST", "score": 8 },
    { "key": "DILIGENCE", "score": 9 },
    { "key": "RESPONSIBILITY", "score": 8 },
    { "key": "COLLABORATION", "score": 7 },
    { "key": "COMMUNICATION", "score": 7 },
    { "key": "GROWTH_POTENTIAL", "score": 9 }
  ],
  "rehireIntent": true
}
```
→ `{ evaluationId, status: "COMPLETED", completedAt, resultNotified, opinionDueAt }`

- 메일(또는 로그)의 `/evaluation/result/<토큰>`을 `resultToken`에 저장합니다.
- `rehireIntent`는 `true`/`false`만, 코멘트 등 서술형 필드는 400입니다. 제출 후 점수는 수정할 수 없습니다.
- 대표 검증 기한(퇴사일 + 15일)이 지나면 410 `EVALUATION_EXPIRED`, 직원이 재직 중이면 403 `STILL_EMPLOYED`입니다.

---

## 9. 결과 확인 → 의견 제출

**9-1. 결과 조회 (직원)**
```
GET {{baseUrl}}/evaluations/result/{{resultToken}}
```
→ `items[{ question, selfScore, ceoScore, scoreGap }]`, `commonCompetencies`, `rehireIntent`, `opinion{ allowed, submitted, dueAt }`

- `scoreGap = ceoScore - selfScore` (자기점수가 없으면 null)
- 처음 열면 결과 확인 시각이 기록됩니다. 링크는 소비되지 않아 여러 번 볼 수 있습니다.

**9-2. 의견 제출 (직원)**
```
POST {{baseUrl}}/evaluations/result/{{resultToken}}/opinion
```
```json
{ "content": "대표 검증 결과 중 협업 점수에 대해 보완 설명을 제출합니다." }
```
→ `{ evaluationId, opinionId, submittedAt }`

- 1회만 제출할 수 있고, 대표 검증 완료 + 7일 KST 23:59:59까지 가능합니다.
- 앞뒤 공백 제거 후 1~1000자. 의견을 내도 점수는 바뀌지 않습니다.

**9-3. 결과 조회 (대표)**
```
GET {{baseUrl}}/evaluations/{{evaluationId}}/result
```
→ 자기선언 답변·자기점수·대표점수·`scoreGap`·역량·`rehireIntent`, `notification{ sent, viewedAt }`, `employeeOpinion{ submitted, content, submittedAt, dueAt }`

- 9-1에서 직원이 결과를 열었으면 `notification.viewedAt`, 9-2에서 의견을 냈으면 `employeeOpinion.content`가 채워집니다.

---

## 상태 변화 요약

| 단계 | Employee | Declaration | Evaluation |
|---|---|---|---|
| 3. 직원 등록 | `EMPLOYED` / `NOT_SENT` | — | — |
| 4. 질문지 발송 | 선언 `SENT` | `SENT` | — |
| 5. 자기선언 제출 | 선언 `SUBMITTED` | `SUBMITTED` | — |
| 6. 퇴사 등록 | `RESIGNED` | — | `SELF_PENDING` |
| 7. 자기평가 제출 | — | — | `CEO_PENDING` |
| (자기평가 기한 초과) | — | — | `SELF_EXPIRED` |
| 8. 대표 검증 제출 | — | — | `COMPLETED` |
| (대표 검증 기한 초과) | — | — | `CEO_EXPIRED` |

- 기한 초과 상태는 매시간 도는 스케줄러가 바꿉니다. 다만 API는 마감 시각을 직접 확인하므로, 스케줄러가 돌기 전에도 기한이 지나면 바로 막힙니다.

## 자주 만나는 오류

| 코드 | 상황 | 해결 |
|---|---|---|
| 401 `UNAUTHORIZED` | `ceoToken` 없음·만료(기본 1시간) | 1단계 다시 로그인 |
| 410 `LINK_EXPIRED` | 직원 링크 만료·폐기, 토큰 오타 | 메일·로그의 최신 링크 확인 |
| 409 `ALREADY_SUBMITTED` | 같은 링크로 이미 제출 | 다음 단계로 진행 |
| 409 `ACTIVE_DECLARATION_EXISTS` | 제출 전 질문지가 이미 있음 | 기존 질문지 링크로 제출 |
| 409 `DECLARATION_NOT_SUBMITTED` | 자기선언 제출 전 퇴사 등록 | 5단계 먼저 |
| 409 `INVALID_EVALUATION_STATUS` | 자기평가 진행 중에 대표 검증 시도 | 7단계 먼저(또는 자기평가 기한 경과 대기) |
| 409 `EVALUATION_NOT_COMPLETED` | 대표 검증 전 결과 조회 | 8단계 먼저 |
