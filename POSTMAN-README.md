# Postman Test Suite — Music App Backend

## Import vào Postman

1. Mở Postman
2. **File → Import** (hoặc `Ctrl+O`)
3. Chọn cả 2 file:
   - `postman/Music-App-Backend.postman_collection.json`
   - `postman/Music-App-Local.postman_environment.json`
4. Góc trên-phải Postman → chọn environment **"Music App — Local"**

## Chuẩn bị trước khi chạy

1. Server đang chạy:

   ```powershell
   cd "d:\Another\Mp3\Backend"
   npm run dev
   ```

   Thấy log `MongoDB connected` + `Server running on port 5000`.

2. Có sẵn 1 file MP3 bất kỳ trong máy để test upload. Copy vào thư mục `d:\Another\Mp3\Backend\sample.mp3`.

## Thứ tự chạy (rất quan trọng)

Mở Postman → click vào **Collection** → tab **Run** → chọn environment → **Run Music App Backend**.

Collection chạy tuần tự theo folder, mỗi folder phụ thuộc folder trước:

```
0. Health Check
   ↓
1. Auth (register/login/me/refresh + edge cases)
   ↓
2. Tracks (upload → list → get → update → stream FULL → stream RANGE → delete)
   ↓
3. Groups (create → list → add track → reorder → rename → delete)
   ↓
4. Player State (get default → update → get verify)
   ↓
5. Auth Cross-User (register user B → test data isolation)
```

## Test Cases tổng cộng

### 0. Health Check (1 case)

- `GET /health` → 200

### 1. Auth (8 cases)

| #   | Endpoint       | Case                          | Expected             |
| --- | -------------- | ----------------------------- | -------------------- |
| 1   | POST /register | happy path                    | 201, lưu token       |
| 2   | POST /register | email trùng                   | 409                  |
| 3   | POST /register | invalid email + password ngắn | 400                  |
| 4   | POST /login    | happy path                    | 200, lưu token       |
| 5   | POST /login    | sai password                  | 401                  |
| 6   | GET /me        | happy path                    | 200, trả user        |
| 7   | GET /me        | missing token                 | 401                  |
| 8   | GET /me        | invalid token                 | 401                  |
| 9   | POST /refresh  | happy path                    | 200, accessToken mới |

### 2. Tracks (15 cases)

| #   | Endpoint           | Case                       | Expected                                   |
| --- | ------------------ | -------------------------- | ------------------------------------------ |
| 1   | POST /upload       | happy path (multipart MP3) | 201, có `_id`, `durationSec`, `fileKey`    |
| 2   | POST /upload       | missing file               | 400                                        |
| 3   | POST /upload       | sai MIME type (text)       | 400                                        |
| 4   | GET /tracks        | list mặc định              | 200, có `pagination`                       |
| 5   | GET /tracks        | search theo title          | 200                                        |
| 6   | GET /tracks        | sort=title                 | 200, alphabet đúng                         |
| 7   | GET /tracks/:id    | happy path                 | 200                                        |
| 8   | GET /tracks/:id    | invalid ObjectId           | 400                                        |
| 9   | GET /tracks/:id    | không tồn tại              | 404                                        |
| 10  | PATCH /tracks/:id  | update metadata            | 200                                        |
| 11  | GET /:id/stream    | no Range                   | **200**, có `Accept-Ranges: bytes`         |
| 12  | GET /:id/stream    | Range `0-1023`             | **206**, `Content-Range: bytes 0-1023/...` |
| 13  | GET /:id/stream    | suffix range `-1024`       | **206**, lấy 1KB cuối                      |
| 14  | GET /:id/stream    | open-ended `1024-`         | **206**, từ byte 1024 đến hết              |
| 15  | GET /:id/stream    | range out of bounds        | **416**                                    |
| 16  | GET /:id/stream    | invalid range format       | **416**                                    |
| 17  | GET /:id/stream    | missing auth               | 401                                        |
| 18  | DELETE /tracks/:id | happy path                 | 200                                        |
| 19  | DELETE /tracks/:id | invalid id                 | 400                                        |

### 3. Groups (15 cases)

| #   | Endpoint                           | Case                    | Expected                        |
| --- | ---------------------------------- | ----------------------- | ------------------------------- |
| 1   | POST /groups                       | happy path              | 201, `tracks=[]`                |
| 2   | POST /groups                       | empty name              | 400                             |
| 3   | GET /groups                        | list all                | 200, có `trackCount`            |
| 4   | GET /groups/:id                    | get populated           | 200                             |
| 5   | POST /groups/:id/tracks            | add track               | 200, có `position`              |
| 6   | POST /groups/:id/tracks            | duplicate (idempotent)  | 200, message "already in group" |
| 7   | POST /groups/:id/tracks            | invalid trackId         | 400                             |
| 8   | GET /groups/:id                    | verify track populated  | 200, track có title             |
| 9   | DELETE /groups/:id/tracks/:trackId | remove                  | 200, `tracks=[]`                |
| 10  | POST /groups/:id/tracks            | add lại để test reorder | 200                             |
| 11  | PATCH /groups/:id/reorder          | happy path              | 200                             |
| 12  | PATCH /groups/:id/reorder          | empty array             | 400                             |
| 13  | PATCH /groups/:id                  | rename                  | 200                             |
| 14  | DELETE /groups/:id                 | delete                  | 200                             |
| 15  | GET /groups/:id                    | sau khi delete          | 404                             |

### 4. Player State (5 cases)

| #   | Endpoint            | Case                         | Expected                |
| --- | ------------------- | ---------------------------- | ----------------------- |
| 1   | GET /player/state   | first time                   | 200, default state      |
| 2   | PATCH /player/state | set track + playing + repeat | 200                     |
| 3   | PATCH /player/state | chỉ update positionSec       | 200, isPlaying vẫn true |
| 4   | PATCH /player/state | invalid repeatMode           | 400                     |
| 5   | GET /player/state   | verify persisted             | 200, positionSec=120    |

### 5. Cross-User Authorization (2 cases)

| #   | Endpoint            | Case                    | Expected                   |
| --- | ------------------- | ----------------------- | -------------------------- |
| 1   | POST /auth/register | tạo user B              | 201, lưu tokenB            |
| 2   | GET /tracks/:id     | user B xem track user A | **404** (authorization)    |
| 3   | GET /tracks         | user B list tracks      | 200, `[]` (data isolation) |

## Test Cases quan trọng nhất (Phải pass hết)

1. **Range requests 206** (5 cases: full/206/suffix/open-ended/416) — đây là core của audio player
2. **Data isolation cross-user** — user B không thấy track user A
3. **Idempotent add track to group** — duplicate không bị lỗi

## Tự động hóa trong Collection

Mỗi request có script **Tests** tự động kiểm tra:

- Status code đúng
- Response shape đúng (success, data, errors)
- Business logic (e.g. position tăng dần, track populated)

Một số request còn **auto-save** vào environment:

- `Register`, `Login`, `Refresh` → lưu `accessToken`, `refreshToken`, `userId`
- `Upload track` → lưu `trackId`, `trackTitle`
- `Create group` → lưu `groupId`

Sau khi các request này chạy, các request sau dùng biến `{{trackId}}`, `{{groupId}}`... tự động.

## Cách chạy nhanh nhất

1. **Collection Runner** (khuyến nghị cho CI):
   - Click collection → tab **Run** → chọn env → **Run Music App Backend**
   - Tất cả ~50 case chạy tuần tự, hiển thị pass/fail từng cái

2. **Chạy từng request** (khi debug):
   - Mở folder → click request → **Send**
   - Xem response ở panel dưới

3. **Watch server logs** ở terminal `npm run dev` để thấy request log real-time.

## Nếu test fail

| Lỗi thường gặp         | Nguyên nhân                                       | Fix                                               |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------- |
| `ECONNREFUSED`         | Server chưa chạy                                  | `npm run dev`                                     |
| `401` sau khi register | Token chưa kịp lưu                                | Run collection qua Runner (tuần tự), đừng chạy lẻ |
| Upload fail 400        | File `sample.mp3` chưa có hoặc field name sai     | Tạo `d:\Another\Mp3\Backend\sample.mp3`           |
| Range không trả 206    | R2 không support Range, hoặc controller parse sai | Check server logs                                 |
| 416 thay vì 200        | Server không clamp range out of bounds            | Check stream controller                           |
| Cross-user 404 fail    | Controller không filter theo `owner`              | Check track controller                            |

---

# Chat & Messaging Test Suite

File: `postman/Chat-Messaging.postman_collection.json` (50 test cases, 7 folders)

## Thứ tự chạy (Postman Collection Runner)

```
1. Setup Users (User A, User B, User C)
   ↓
2. Contacts (Send request, Duplicate 400, Accept, Decline, List friends)
   ↓
3. Direct Conversations (Create 1-1, Idempotent 200, Self-chat 400, Non-member 403)
   ↓
4. Group Conversations (Create group, Rename, Add member, Presigned upload URL)
   ↓
5. Messages & Chat Flow (Send text, Reply, Image mediaUrl, Cursor pagination, Edit, React/Toggle emoji, Mark read, Soft delete)
   ↓
6. Group Membership (Kick member 403/200, Kicked access 403, Leave group 200)
   ↓
7. Presence & Heartbeat (Heartbeat 200, Batch query 200)
```

## File structure

```
d:\Another\Mp3\Backend\
├── postman/
│   ├── Music-App-Backend.postman_collection.json   ← Test suite nghe nhạc & albums
│   ├── Chat-Messaging.postman_collection.json      ← Test suite chat, tin nhắn, contacts, presence
│   └── Music-App-Local.postman_environment.json    ← Environment dùng chung cho cả 2 bộ test
├── POSTMAN-README.md
└── ...
```
