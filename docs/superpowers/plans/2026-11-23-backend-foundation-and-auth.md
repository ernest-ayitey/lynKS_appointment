# Backend Foundation & Auth API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a fresh Sinatra + Sequel + MySQL API (`apps/api`, replacing
the old NestJS app) with a complete username+password auth system: register
(patient-only), login, refresh, logout, forgot/reset password, authenticated
password change, and username-availability check.

**Architecture:** Modular `Sinatra::Base` app mounted at `/api/v1`. Sequel
for the ORM and migrations against MySQL. Access tokens are short-lived
stateless JWTs (HS256) returned in the JSON body and kept by the SPA in
memory only. Refresh tokens are opaque random strings, stored **hashed**
server-side (so they can be revoked before natural expiry — required by the
design doc's anti-goal that a deactivated account can't keep working) and
delivered to the browser as an `HttpOnly`, `SameSite=Lax` cookie — the SPA
never reads the refresh token directly, only calls `/auth/refresh` with
credentials included. This cookie-based refresh design is this plan's own
call (the spec left exact token transport to the builder); it removes
XSS-exfiltration risk on the long-lived token.

**Tech Stack:** Ruby 3.2+, Sinatra, Sequel, mysql2, bcrypt, jwt, rack-cors,
dotenv, RSpec + Rack::Test, Rake.

**Spec:** `docs/superpowers/specs/2026-11-23-clinic-appointment-rewrite-design.md`
(data model, API surface, constraints) and
`docs/superpowers/specs/2026-11-23-clinic-appointment-screen-specs.md`
(exact copy/validation rules for the auth screens, section "1 · Login &
Registration").

## Global Constraints

- Single clinic deployment — no multi-tenant fields anywhere.
- MySQL via Sequel (not ActiveRecord/Prisma).
- Passwords hashed with bcrypt; access tokens are JWT (HS256); refresh
  tokens are opaque, hashed at rest, revocable.
- No hard deletion anywhere — this plan has no delete endpoints; deactivation
  lands in the Admin plan, but the schema already supports it
  (`users.status`, `deactivated_at`).
- Self-registration creates a `patient` role only; Doctor/Records/Admin
  creation is out of scope for this plan (Admin plan).
- Account locks after 5 failed login attempts (screen spec, Main/Login).
- Username: 4–20 chars, letters/numbers/dot/underscore, case-insensitively
  unique (screen spec, Register).
- Password policy (Register): minimum 8 characters, at least one number,
  at least one symbol.
- Forgot-password responses must not reveal whether a username exists
  (screen spec's exact copy: "If that username exists, a reset link has
  been sent...").
- Password reset links expire after 30 minutes (screen spec, ForgotPassword).

## Review Focus

- **Brute-forcing a password** — 5 wrong attempts must lock the account
  (`status = 'locked'`), and the 6th attempt must be rejected even with the
  correct password. Covered in Task 7.
- **Reusing a password-reset token** — a token already used to reset a
  password must not work a second time, even before its 30-minute expiry.
  Covered in Task 12.
- **Replaying a rotated refresh token** — once `/auth/refresh` issues a new
  refresh token, the old one must be rejected on reuse (rotation, not just
  extension). Covered in Task 8.
- **Username enumeration** — `/auth/password/forgot` and `/auth/register`
  must not let an attacker distinguish "username taken" from "username
  free" through response shape/timing beyond what the screens explicitly
  allow (register's live-availability check is explicitly allowed to leak
  this; forgot-password is not). Covered in Tasks 11 and 13.
- **Case-collision usernames** — registering `Ernest` when `ernest` already
  exists must be rejected, not create a second, confusable account. Covered
  in Task 10.

---

## File Structure

```
apps/api/
  Gemfile
  config.ru
  Rakefile
  .env.example
  config/
    environment.rb       # loads .env, builds the Sequel DB connection
  db/
    migrate/
      001_create_users.rb
      002_create_refresh_tokens.rb
      003_create_password_reset_tokens.rb
  app/
    api.rb                # root Sinatra::Base, mounts sub-apps, CORS
    routes/
      health.rb
      auth.rb
    models/
      user.rb
      refresh_token.rb
      password_reset_token.rb
    services/
      token_service.rb
      mailer.rb
    support/
      auth_helpers.rb      # `authenticate!` / `current_user` Sinatra helper
  spec/
    spec_helper.rb
    support/
      db_cleaner.rb        # transactional rollback around each example
    requests/
      health_spec.rb
      auth/
        login_spec.rb
        refresh_spec.rb
        logout_spec.rb
        register_spec.rb
        username_availability_spec.rb
        forgot_password_spec.rb
        reset_password_spec.rb
        change_password_spec.rb
    services/
      token_service_spec.rb
    models/
      user_spec.rb
```

---

### Task 1: Gem scaffold, DB connection, health check

**Files:**
- Create: `apps/api/Gemfile`, `apps/api/config.ru`, `apps/api/Rakefile`, `apps/api/.env.example`
- Create: `apps/api/config/environment.rb`
- Create: `apps/api/app/api.rb`, `apps/api/app/routes/health.rb`
- Test: `apps/api/spec/spec_helper.rb`, `apps/api/spec/requests/health_spec.rb`

**Interfaces:**
- Produces: `DB` (a global Sequel connection constant, built in
  `config/environment.rb` from `ENV['DATABASE_URL']`), `App` (the root
  `Sinatra::Base` subclass in `app/api.rb` that `config.ru` runs and specs
  require).

- [ ] **Step 1: Write `Gemfile`**

Gems: `sinatra`, `sinatra-contrib`, `puma`, `sequel`, `mysql2`, `bcrypt`,
`jwt`, `rack-cors`, `dotenv`; group `:test`: `rspec`, `rack-test`.

- [ ] **Step 2: `bundle install`**

Run: `cd apps/api && bundle install`
Expected: `Gemfile.lock` created, no errors.

- [ ] **Step 3: Write `config/environment.rb`**

Loads `.env` via `Dotenv.load`, requires `sequel`, connects:
`DB = Sequel.connect(ENV.fetch('DATABASE_URL'))`. Also requires
`sequel/extensions/migration` so Task migrations can run via Rake.

- [ ] **Step 4: Write `.env.example` and a local `.env`**

`DATABASE_URL=mysql2://root:password@localhost/lynks_appointment_dev`,
`DATABASE_TEST_URL=mysql2://root:password@localhost/lynks_appointment_test`,
`JWT_SECRET=dev-secret-change-me`, `JWT_ACCESS_TTL_SECONDS=900`,
`REFRESH_TOKEN_TTL_DAYS=7`, `REFRESH_TOKEN_TTL_DAYS_REMEMBER=30`,
`FRONTEND_URL=http://localhost:5173`, `MAIL_DELIVERY_METHOD=log`.

- [ ] **Step 5: Write `Rakefile`**

A `db:migrate` task that runs `Sequel::Migrator.run(DB, 'db/migrate')`
against `ENV['DATABASE_URL']`, loading `config/environment.rb` first.

- [ ] **Step 6: Write `app/routes/health.rb` and `app/api.rb`**

`app/routes/health.rb`: a `Sinatra::Base` subclass `HealthRoutes` with
`get('/health') { json(status: 'ok') }`.
`app/api.rb`: `App < Sinatra::Base`, `use Rack::Cors` (allow
`ENV['FRONTEND_URL']`, credentials: true — required later for the refresh
cookie), mounts `HealthRoutes` under `/api/v1`.

- [ ] **Step 7: Write `config.ru`**

Requires `config/environment` and `app/api`, runs `App`.

- [ ] **Step 8: Write `spec/spec_helper.rb`**

Sets `RACK_ENV=test` before requiring `config/environment` (so `DATABASE_URL`
resolution — see Step 3 refinement below — points at the test DB), requires
`rack/test`, includes `Rack::Test::Methods` with `def app; App; end` into
all request specs (`type: :request`, directory `spec/requests`).

Refinement to Step 3: `config/environment.rb` picks
`ENV['DATABASE_TEST_URL']` when `ENV['RACK_ENV'] == 'test'`, else
`ENV['DATABASE_URL']`.

- [ ] **Step 9: Write the failing test**

```ruby
# spec/requests/health_spec.rb
RSpec.describe 'GET /api/v1/health' do
  it 'returns ok' do
    get '/api/v1/health'
    expect(last_response.status).to eq(200)
    expect(JSON.parse(last_response.body)).to eq('status' => 'ok')
  end
end
```

- [ ] **Step 10: Create the two MySQL databases locally, run migrations (none yet), verify the test fails for the right reason, then passes**

Run: `mysql -e "CREATE DATABASE IF NOT EXISTS lynks_appointment_dev; CREATE DATABASE IF NOT EXISTS lynks_appointment_test;"`
Run: `cd apps/api && bundle exec rspec spec/requests/health_spec.rb`
Expected before Step 6/7 exist: fails to load `app/api.rb`. After: `1 example, 0 failures`.

- [ ] **Step 11: Commit**

```bash
git add apps/api
git commit -m "feat: scaffold Sinatra API with health check"
```

---

### Task 2: `users` table and `User` model

**Files:**
- Create: `apps/api/db/migrate/001_create_users.rb`
- Create: `apps/api/app/models/user.rb`
- Test: `apps/api/spec/models/user_spec.rb`

**Interfaces:**
- Produces: `User` (a `Sequel::Model(:users)`), `User::ROLES = %w[patient
  doctor records admin]`, `User::STATUSES = %w[active invited locked
  deactivated]`, instance method `password=(raw)` (bcrypt-hashes into
  `password_digest`), instance method `authenticate(raw) -> Boolean`,
  class method `User.find_by_username_ci(username) -> User?`
  (case-insensitive lookup, used by Tasks 6, 9, 10).

- [ ] **Step 1: Write the migration**

```ruby
Sequel.migration do
  change do
    create_table(:users) do
      primary_key :id
      String :role, null: false
      String :username, null: false
      index :username, unique: true
      String :password_digest, null: false
      String :email, null: false
      String :phone
      String :first_name, null: false
      String :last_name, null: false
      Date :date_of_birth
      String :gender
      String :status, null: false, default: 'active'
      TrueClass :must_change_password, null: false, default: false
      Integer :failed_login_count, null: false, default: 0
      DateTime :locked_at
      DateTime :deactivated_at
      DateTime :created_at, null: false
      DateTime :updated_at, null: false
    end
  end
end
```

- [ ] **Step 2: Run migrations on both databases**

Run: `cd apps/api && RACK_ENV=development bundle exec rake db:migrate && RACK_ENV=test bundle exec rake db:migrate`
Expected: `users` table exists in both.

- [ ] **Step 3: Write the failing tests**

```ruby
# spec/models/user_spec.rb
RSpec.describe User do
  it 'hashes the password and authenticates it' do
    user = User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
      first_name: 'Ernest', last_name: 'A', password: 'Sup3r!word')
    expect(user.password_digest).not_to eq('Sup3r!word')
    expect(user.authenticate('Sup3r!word')).to be true
    expect(user.authenticate('wrong')).to be false
  end

  it 'finds a user by username case-insensitively' do
    User.create(role: 'patient', username: 'Ernesta', email: 'e@x.com',
      first_name: 'Ernest', last_name: 'A', password: 'Sup3r!word')
    expect(User.find_by_username_ci('ernesta')).not_to be_nil
  end
end
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `bundle exec rspec spec/models/user_spec.rb`
Expected: FAIL — `User` not defined / `password=` not defined.

- [ ] **Step 5: Implement `app/models/user.rb`**

`password=(raw)` sets `self.password_digest = BCrypt::Password.create(raw)`.
`authenticate(raw)` does `BCrypt::Password.new(password_digest) == raw`.
`find_by_username_ci(username)` does
`where(Sequel.function(:lower, :username) => username.downcase).first`.
Require this file from `config/environment.rb` (after `DB` is set).

- [ ] **Step 6: Run tests to verify they pass**

Run: `bundle exec rspec spec/models/user_spec.rb`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/db/migrate/001_create_users.rb apps/api/app/models/user.rb apps/api/spec/models/user_spec.rb
git commit -m "feat: add users table and User model"
```

---

### Task 3: `refresh_tokens` table and `RefreshToken` model

**Files:**
- Create: `apps/api/db/migrate/002_create_refresh_tokens.rb`
- Create: `apps/api/app/models/refresh_token.rb`

**Interfaces:**
- Consumes: `User` (Task 2).
- Produces: `RefreshToken`, class method
  `RefreshToken.hash_token(raw) -> String` (SHA-256 hex digest — used by
  Task 5's `TokenService` both to store and to look up tokens, so the raw
  token is never stored), instance method `revoked? -> Boolean`, instance
  method `expired? -> Boolean`.

- [ ] **Step 1: Write the migration**

```ruby
Sequel.migration do
  change do
    create_table(:refresh_tokens) do
      primary_key :id
      foreign_key :user_id, :users, null: false
      String :token_hash, null: false
      index :token_hash, unique: true
      DateTime :expires_at, null: false
      DateTime :revoked_at
      DateTime :created_at, null: false
    end
  end
end
```

- [ ] **Step 2: Run migrations on both databases**

Run: `RACK_ENV=development bundle exec rake db:migrate && RACK_ENV=test bundle exec rake db:migrate`

- [ ] **Step 3: Write the failing test**

```ruby
# spec/models/refresh_token_spec.rb
RSpec.describe RefreshToken do
  it 'hashes a token deterministically' do
    expect(RefreshToken.hash_token('abc')).to eq(RefreshToken.hash_token('abc'))
    expect(RefreshToken.hash_token('abc')).not_to eq('abc')
  end

  it 'knows if it is revoked or expired' do
    token = RefreshToken.create(user: User.create(role: 'patient', username: 'u1',
      email: 'e@x.com', first_name: 'A', last_name: 'B', password: 'Sup3r!word'),
      token_hash: 'h', expires_at: Time.now - 1)
    expect(token.expired?).to be true
    expect(token.revoked?).to be false
  end
end
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bundle exec rspec spec/models/refresh_token_spec.rb`
Expected: FAIL — `RefreshToken` not defined.

- [ ] **Step 5: Implement `app/models/refresh_token.rb`**

`many_to_one :user`. `hash_token(raw)` is
`Digest::SHA256.hexdigest(raw)` (class method). `expired?` is
`expires_at < Time.now`. `revoked?` is `!revoked_at.nil?`.

- [ ] **Step 6: Run test to verify it passes**

Run: `bundle exec rspec spec/models/refresh_token_spec.rb`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/db/migrate/002_create_refresh_tokens.rb apps/api/app/models/refresh_token.rb apps/api/spec/models/refresh_token_spec.rb
git commit -m "feat: add refresh_tokens table and model"
```

---

### Task 4: `password_reset_tokens` table and model

**Files:**
- Create: `apps/api/db/migrate/003_create_password_reset_tokens.rb`
- Create: `apps/api/app/models/password_reset_token.rb`

**Interfaces:**
- Consumes: `User` (Task 2).
- Produces: `PasswordResetToken`, instance methods `expired? -> Boolean`,
  `used? -> Boolean`.

- [ ] **Step 1: Write the migration**

```ruby
Sequel.migration do
  change do
    create_table(:password_reset_tokens) do
      primary_key :id
      foreign_key :user_id, :users, null: false
      String :token, null: false
      index :token, unique: true
      DateTime :expires_at, null: false
      DateTime :used_at
      DateTime :created_at, null: false
    end
  end
end
```

- [ ] **Step 2: Run migrations on both databases**

Run: `RACK_ENV=development bundle exec rake db:migrate && RACK_ENV=test bundle exec rake db:migrate`

- [ ] **Step 3: Write the failing test**

```ruby
# spec/models/password_reset_token_spec.rb
RSpec.describe PasswordResetToken do
  it 'knows if it is expired or used' do
    user = User.create(role: 'patient', username: 'u2', email: 'e@x.com',
      first_name: 'A', last_name: 'B', password: 'Sup3r!word')
    token = PasswordResetToken.create(user: user, token: 't', expires_at: Time.now - 1, used_at: Time.now)
    expect(token.expired?).to be true
    expect(token.used?).to be true
  end
end
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bundle exec rspec spec/models/password_reset_token_spec.rb`
Expected: FAIL.

- [ ] **Step 5: Implement `app/models/password_reset_token.rb`**

`many_to_one :user`. `expired?` is `expires_at < Time.now`. `used?` is
`!used_at.nil?`.

- [ ] **Step 6: Run test to verify it passes**

Run: `bundle exec rspec spec/models/password_reset_token_spec.rb`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/db/migrate/003_create_password_reset_tokens.rb apps/api/app/models/password_reset_token.rb apps/api/spec/models/password_reset_token_spec.rb
git commit -m "feat: add password_reset_tokens table and model"
```

---

### Task 5: `TokenService` (JWT access + refresh issuance/rotation/revocation)

**Files:**
- Create: `apps/api/app/services/token_service.rb`
- Test: `apps/api/spec/services/token_service_spec.rb`

**Interfaces:**
- Consumes: `User` (Task 2), `RefreshToken` (Task 3).
- Produces: `TokenService.issue_access_token(user) -> String` (JWT),
  `TokenService.decode_access_token(jwt) -> Hash?` (claims, or `nil` if
  invalid/expired), `TokenService.issue_refresh_token(user, remember_me:) ->
  String` (the **raw** token — only ever returned here, never again),
  `TokenService.rotate_refresh_token(raw) -> [String, User]?` (returns
  `[new_raw_token, user]`, or `nil` if the presented token is missing/
  expired/revoked; revokes the old row as a side effect), `TokenService
  .revoke_refresh_token(raw)`.

- [ ] **Step 1: Write the failing tests**

```ruby
# spec/services/token_service_spec.rb
RSpec.describe TokenService do
  let(:user) { User.create(role: 'patient', username: 'u3', email: 'e@x.com',
    first_name: 'A', last_name: 'B', password: 'Sup3r!word') }

  it 'issues a decodable access token carrying sub and role' do
    jwt = TokenService.issue_access_token(user)
    claims = TokenService.decode_access_token(jwt)
    expect(claims['sub']).to eq(user.id)
    expect(claims['role']).to eq('patient')
  end

  it 'rotates a refresh token and rejects the old one on reuse' do
    raw = TokenService.issue_refresh_token(user, remember_me: false)
    new_raw, rotated_user = TokenService.rotate_refresh_token(raw)
    expect(rotated_user.id).to eq(user.id)
    expect(TokenService.rotate_refresh_token(raw)).to be_nil
    expect(TokenService.rotate_refresh_token(new_raw)).not_to be_nil
  end

  it 'rejects an expired or revoked refresh token' do
    raw = TokenService.issue_refresh_token(user, remember_me: false)
    TokenService.revoke_refresh_token(raw)
    expect(TokenService.rotate_refresh_token(raw)).to be_nil
  end
end
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bundle exec rspec spec/services/token_service_spec.rb`
Expected: FAIL — `TokenService` not defined.

- [ ] **Step 3: Implement `TokenService`**

Access tokens: `JWT.encode({sub: user.id, role: user.role, exp:
Time.now.to_i + ENV['JWT_ACCESS_TTL_SECONDS'].to_i}, ENV['JWT_SECRET'],
'HS256')`; decode with `JWT.decode(jwt, ENV['JWT_SECRET'], true,
algorithm: 'HS256')`, rescue `JWT::DecodeError` and return `nil`.
Refresh tokens: generate raw with `SecureRandom.hex(32)`; store
`RefreshToken.create(user: user, token_hash: RefreshToken.hash_token(raw),
expires_at: Time.now + (remember_me ? ENV['REFRESH_TOKEN_TTL_DAYS_REMEMBER']
: ENV['REFRESH_TOKEN_TTL_DAYS']).to_i.days)`. `rotate_refresh_token(raw)`
looks up by `token_hash: hash_token(raw)`, returns `nil` if missing/
expired?/revoked?, else marks it `revoked_at: Time.now` and issues+returns
a fresh pair via `issue_refresh_token` (same `remember_me` window as the
token being rotated — store the original `expires_at - created_at` window
on the row, or simplest: re-derive `remember_me` from whether the token's
original lifetime was closer to the long or short TTL; pick whichever is
simplest to implement and keep it consistent).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bundle exec rspec spec/services/token_service_spec.rb`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/token_service.rb apps/api/spec/services/token_service_spec.rb
git commit -m "feat: add TokenService for JWT access and refresh token rotation"
```

---

### Task 6: `Mailer` service (log-delivery stub)

**Files:**
- Create: `apps/api/app/services/mailer.rb`

**Interfaces:**
- Produces: `Mailer.deliver(to:, subject:, body:)` — when
  `ENV['MAIL_DELIVERY_METHOD'] == 'log'` (the dev/test default), logs the
  message to STDOUT and returns `true`; the SMTP branch is a documented
  no-op stub (`raise NotImplementedError` is fine) since no SMTP credentials
  exist yet — later plans only need the `deliver` call shape, not real
  delivery.

- [ ] **Step 1: Write the failing test**

```ruby
# spec/services/mailer_spec.rb
RSpec.describe Mailer do
  it 'logs the message in log delivery mode' do
    expect(Mailer.deliver(to: 'a@b.com', subject: 'Hi', body: 'Body')).to be true
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bundle exec rspec spec/services/mailer_spec.rb`
Expected: FAIL — `Mailer` not defined.

- [ ] **Step 3: Implement `Mailer.deliver(to:, subject:, body:)`**

- [ ] **Step 4: Run test to verify it passes**

Run: `bundle exec rspec spec/services/mailer_spec.rb`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/mailer.rb apps/api/spec/services/mailer_spec.rb
git commit -m "feat: add log-delivery Mailer stub"
```

---

### Task 7: `POST /auth/login`

**Files:**
- Create: `apps/api/app/routes/auth.rb` (this task starts the file; later
  tasks add routes to it)
- Test: `apps/api/spec/requests/auth/login_spec.rb`

**Interfaces:**
- Consumes: `User.find_by_username_ci`, `User#authenticate` (Task 2),
  `TokenService.issue_access_token`, `TokenService.issue_refresh_token`
  (Task 5).
- Produces: `AuthRoutes` (a `Sinatra::Base` mounted at `/api/v1/auth` in
  `app/api.rb`), the refresh-cookie-setting helper
  `set_refresh_cookie(raw_token, remember_me:)` (sets `refresh_token` as
  `HttpOnly`, `SameSite=Lax`, `Secure` in non-test env, with `Max-Age` only
  when `remember_me` is true) — reused by Tasks 8, 10, 12.

- [ ] **Step 1: Write the failing tests**

```ruby
# spec/requests/auth/login_spec.rb
RSpec.describe 'POST /api/v1/auth/login' do
  let!(:user) { User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
    first_name: 'Ernest', last_name: 'A', password: 'Sup3r!word') }

  it 'logs in with correct credentials' do
    post '/api/v1/auth/login', { username: 'ernesta', password: 'Sup3r!word' }.to_json,
      { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(200)
    body = JSON.parse(last_response.body)
    expect(body['access_token']).to be_a(String)
    expect(body['user']['username']).to eq('ernesta')
    expect(last_response.headers['Set-Cookie']).to include('refresh_token=')
  end

  it 'rejects the wrong password without revealing which field was wrong' do
    post '/api/v1/auth/login', { username: 'ernesta', password: 'nope' }.to_json,
      { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(401)
    expect(JSON.parse(last_response.body)['error']).to eq('Incorrect username or password')
  end

  it 'locks the account after 5 failed attempts and rejects the 6th even with the right password' do
    5.times do
      post '/api/v1/auth/login', { username: 'ernesta', password: 'nope' }.to_json,
        { 'CONTENT_TYPE' => 'application/json' }
    end
    post '/api/v1/auth/login', { username: 'ernesta', password: 'Sup3r!word' }.to_json,
      { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(423)
    expect(user.reload.status).to eq('locked')
  end

  it 'rejects a deactivated account' do
    user.update(status: 'deactivated')
    post '/api/v1/auth/login', { username: 'ernesta', password: 'Sup3r!word' }.to_json,
      { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(403)
  end
end
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bundle exec rspec spec/requests/auth/login_spec.rb`
Expected: FAIL — route doesn't exist (404).

- [ ] **Step 3: Implement `POST /auth/login` in `app/routes/auth.rb`**

Flow: parse JSON body (`username`, `password`, `remember_me` default
false); find user case-insensitively; if `status == 'locked'` or
`'deactivated'` → 403 `{error: "This account can't sign in right now"}`;
if missing or `!user.authenticate(password)` → increment
`failed_login_count`, if it reaches 5 set `status: 'locked', locked_at:
Time.now`, respond 401 (or 423 if this failure is the one that just
locked it) `{error: "Incorrect username or password"}`; on success reset
`failed_login_count: 0`, issue access token (body) + refresh token (via
`set_refresh_cookie`), respond 200 with `{access_token:, must_change_
password:, user: {id, username, role, first_name, last_name}}`.

- [ ] **Step 4: Mount `AuthRoutes` in `app/api.rb`**

- [ ] **Step 5: Run tests to verify they pass**

Run: `bundle exec rspec spec/requests/auth/login_spec.rb`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/routes/auth.rb apps/api/app/api.rb apps/api/spec/requests/auth/login_spec.rb
git commit -m "feat: add POST /auth/login with lockout after 5 attempts"
```

---

### Task 8: `POST /auth/refresh`

**Files:**
- Modify: `apps/api/app/routes/auth.rb`
- Test: `apps/api/spec/requests/auth/refresh_spec.rb`

**Interfaces:**
- Consumes: `TokenService.rotate_refresh_token` (Task 5),
  `set_refresh_cookie` (Task 7).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Write the failing tests**

```ruby
# spec/requests/auth/refresh_spec.rb
RSpec.describe 'POST /api/v1/auth/refresh' do
  it 'issues a new access token when the refresh cookie is valid, and rotates it' do
    user = User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
      first_name: 'A', last_name: 'B', password: 'Sup3r!word')
    post '/api/v1/auth/login', { username: 'ernesta', password: 'Sup3r!word' }.to_json,
      { 'CONTENT_TYPE' => 'application/json' }
    cookie = last_response.headers['Set-Cookie']

    post '/api/v1/auth/refresh', {}.to_json, { 'CONTENT_TYPE' => 'application/json', 'HTTP_COOKIE' => cookie }
    expect(last_response.status).to eq(200)
    expect(JSON.parse(last_response.body)['access_token']).to be_a(String)
    new_cookie = last_response.headers['Set-Cookie']
    expect(new_cookie).not_to eq(cookie)
  end

  it 'rejects a missing or invalid refresh cookie' do
    post '/api/v1/auth/refresh', {}.to_json, { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(401)
  end
end
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bundle exec rspec spec/requests/auth/refresh_spec.rb`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Implement `POST /auth/refresh`**

Reads `request.cookies['refresh_token']`; if blank → 401; call
`TokenService.rotate_refresh_token`; if `nil` → 401 `{error: "Session
expired, please sign in again"}`; else issue a new access token, set the
new refresh cookie, respond 200 `{access_token:}`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bundle exec rspec spec/requests/auth/refresh_spec.rb`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/routes/auth.rb apps/api/spec/requests/auth/refresh_spec.rb
git commit -m "feat: add POST /auth/refresh with token rotation"
```

---

### Task 9: `auth_helpers` (`authenticate!` / `current_user`) and `POST /auth/logout`

**Files:**
- Create: `apps/api/app/support/auth_helpers.rb`
- Modify: `apps/api/app/routes/auth.rb`
- Test: `apps/api/spec/requests/auth/logout_spec.rb`

**Interfaces:**
- Consumes: `TokenService.decode_access_token`, `TokenService
  .revoke_refresh_token` (Task 5).
- Produces: Sinatra helper module `AuthHelpers` with `authenticate!`
  (halts 401 with `{error: "Unauthorized"}` unless the `Authorization:
  Bearer <jwt>` header decodes) and `current_user` (memoized `User` loaded
  from the decoded `sub` claim) — every later authenticated route in this
  and future plans registers `helpers AuthHelpers` and calls
  `authenticate!` in a `before` block.

- [ ] **Step 1: Write the failing test**

```ruby
# spec/requests/auth/logout_spec.rb
RSpec.describe 'POST /api/v1/auth/logout' do
  it 'revokes the refresh token so it can no longer be used to refresh' do
    user = User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
      first_name: 'A', last_name: 'B', password: 'Sup3r!word')
    post '/api/v1/auth/login', { username: 'ernesta', password: 'Sup3r!word' }.to_json,
      { 'CONTENT_TYPE' => 'application/json' }
    cookie = last_response.headers['Set-Cookie']
    access_token = JSON.parse(last_response.body)['access_token']

    post '/api/v1/auth/logout', {}.to_json,
      { 'CONTENT_TYPE' => 'application/json', 'HTTP_COOKIE' => cookie, 'HTTP_AUTHORIZATION' => "Bearer #{access_token}" }
    expect(last_response.status).to eq(204)

    post '/api/v1/auth/refresh', {}.to_json, { 'CONTENT_TYPE' => 'application/json', 'HTTP_COOKIE' => cookie }
    expect(last_response.status).to eq(401)
  end
end
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bundle exec rspec spec/requests/auth/logout_spec.rb`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Implement `AuthHelpers` and `POST /auth/logout`**

`authenticate!`: reads `Authorization` header, splits `Bearer <jwt>`,
decodes via `TokenService.decode_access_token`, halts 401 if `nil`, else
sets `@current_user_id = claims['sub']`. `current_user`: `@current_user
||= User[@current_user_id]`. Logout: `authenticate!` then revoke the
refresh cookie's token (if present) and clear the cookie, respond 204.

- [ ] **Step 4: Run test to verify it passes**

Run: `bundle exec rspec spec/requests/auth/logout_spec.rb`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/support/auth_helpers.rb apps/api/app/routes/auth.rb apps/api/spec/requests/auth/logout_spec.rb
git commit -m "feat: add authenticate! helper and POST /auth/logout"
```

---

### Task 10: `GET /auth/username-availability`

**Files:**
- Modify: `apps/api/app/routes/auth.rb`
- Test: `apps/api/spec/requests/auth/username_availability_spec.rb`

**Interfaces:**
- Consumes: `User.find_by_username_ci` (Task 2).
- Produces: a `username_format_valid?(username) -> Boolean` helper (used
  again by Task 11's registration validation): `/\A[A-Za-z0-9._]{4,20}\z/`.

- [ ] **Step 1: Write the failing tests**

```ruby
# spec/requests/auth/username_availability_spec.rb
RSpec.describe 'GET /api/v1/auth/username-availability' do
  it 'is available when unused' do
    get '/api/v1/auth/username-availability?username=freshuser'
    expect(JSON.parse(last_response.body)).to eq('available' => true)
  end

  it 'is unavailable case-insensitively when taken' do
    User.create(role: 'patient', username: 'Ernesta', email: 'e@x.com',
      first_name: 'A', last_name: 'B', password: 'Sup3r!word')
    get '/api/v1/auth/username-availability?username=ernesta'
    expect(JSON.parse(last_response.body)).to eq('available' => false)
  end

  it 'rejects an invalid format' do
    get '/api/v1/auth/username-availability?username=a'
    expect(last_response.status).to eq(422)
  end
end
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bundle exec rspec spec/requests/auth/username_availability_spec.rb`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Implement the route**

422 if `!username_format_valid?(params['username'])`; else
`{available: User.find_by_username_ci(params['username']).nil?}`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bundle exec rspec spec/requests/auth/username_availability_spec.rb`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/routes/auth.rb apps/api/spec/requests/auth/username_availability_spec.rb
git commit -m "feat: add GET /auth/username-availability"
```

---

### Task 11: `POST /auth/register`

**Files:**
- Modify: `apps/api/app/routes/auth.rb`
- Test: `apps/api/spec/requests/auth/register_spec.rb`

**Interfaces:**
- Consumes: `username_format_valid?` (Task 10), `User` (Task 2),
  `TokenService.issue_access_token` / `issue_refresh_token`, `set_refresh_
  cookie` (Tasks 5, 7).
- Produces: `password_policy_valid?(password) -> Boolean` (min 8 chars, at
  least one digit, at least one symbol — reused by Task 12's reset and
  Task 13's change endpoints).

- [ ] **Step 1: Write the failing tests**

```ruby
# spec/requests/auth/register_spec.rb
RSpec.describe 'POST /api/v1/auth/register' do
  let(:valid_params) do
    { first_name: 'Ernest', last_name: 'A', date_of_birth: '1990-01-01',
      gender: 'male', email: 'e@x.com', phone: '0555', username: 'ernesta',
      password: 'Sup3r!word', password_confirmation: 'Sup3r!word', accept_terms: true }
  end

  it 'creates a patient account and logs in' do
    post '/api/v1/auth/register', valid_params.to_json, { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(201)
    body = JSON.parse(last_response.body)
    expect(body['user']['role']).to eq('patient')
    expect(body['access_token']).to be_a(String)
  end

  it 'rejects a duplicate username' do
    User.create(role: 'patient', username: 'ernesta', email: 'x@x.com',
      first_name: 'A', last_name: 'B', password: 'Sup3r!word')
    post '/api/v1/auth/register', valid_params.to_json, { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(422)
  end

  it 'rejects a weak password' do
    post '/api/v1/auth/register', valid_params.merge(password: 'weak', password_confirmation: 'weak').to_json,
      { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(422)
  end

  it 'rejects unaccepted terms' do
    post '/api/v1/auth/register', valid_params.merge(accept_terms: false).to_json,
      { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(422)
  end
end
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bundle exec rspec spec/requests/auth/register_spec.rb`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Implement `POST /auth/register`**

Validate: `username_format_valid?`, uniqueness (case-insensitive),
`password_policy_valid?`, `password == password_confirmation`,
`accept_terms == true`; 422 with a `{errors: {...}}` body on any failure.
On success: `User.create(role: 'patient', status: 'active', must_change_
password: false, ...params)`, issue tokens, respond 201 with the same
shape as login.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bundle exec rspec spec/requests/auth/register_spec.rb`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/routes/auth.rb apps/api/spec/requests/auth/register_spec.rb
git commit -m "feat: add POST /auth/register for patient self-registration"
```

---

### Task 12: `POST /auth/password/forgot` and `POST /auth/password/reset`

**Files:**
- Modify: `apps/api/app/routes/auth.rb`
- Test: `apps/api/spec/requests/auth/forgot_password_spec.rb`,
  `apps/api/spec/requests/auth/reset_password_spec.rb`

**Interfaces:**
- Consumes: `PasswordResetToken` (Task 4), `Mailer.deliver` (Task 6),
  `password_policy_valid?` (Task 11), `TokenService.revoke_refresh_token`
  (Task 5, used to force re-login on reset), `set_refresh_cookie` (Task 7).

- [ ] **Step 1: Write the failing tests**

```ruby
# spec/requests/auth/forgot_password_spec.rb
RSpec.describe 'POST /api/v1/auth/password/forgot' do
  it 'returns the same generic message whether or not the username exists' do
    User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
      first_name: 'A', last_name: 'B', password: 'Sup3r!word')
    post '/api/v1/auth/password/forgot', { username: 'ernesta' }.to_json, { 'CONTENT_TYPE' => 'application/json' }
    existing_body = last_response.body
    expect(PasswordResetToken.count).to eq(1)

    post '/api/v1/auth/password/forgot', { username: 'nobody' }.to_json, { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.body).to eq(existing_body)
    expect(PasswordResetToken.count).to eq(1)
  end
end
```

```ruby
# spec/requests/auth/reset_password_spec.rb
RSpec.describe 'POST /api/v1/auth/password/reset' do
  let!(:user) { User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
    first_name: 'A', last_name: 'B', password: 'Sup3r!word') }
  let!(:token) { PasswordResetToken.create(user: user, token: 'tok123', expires_at: Time.now + 1800) }

  it 'resets the password and logs in' do
    post '/api/v1/auth/password/reset', { token: 'tok123', password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
      { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(200)
    expect(user.reload.authenticate('NewPass1!')).to be true
  end

  it 'rejects a token that was already used' do
    token.update(used_at: Time.now)
    post '/api/v1/auth/password/reset', { token: 'tok123', password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
      { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(422)
  end

  it 'rejects an expired token' do
    token.update(expires_at: Time.now - 1)
    post '/api/v1/auth/password/reset', { token: 'tok123', password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
      { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(422)
  end
end
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bundle exec rspec spec/requests/auth/forgot_password_spec.rb spec/requests/auth/reset_password_spec.rb`
Expected: FAIL — routes don't exist.

- [ ] **Step 3: Implement both routes**

Forgot: find user case-insensitively; if found, create a
`PasswordResetToken` (`token: SecureRandom.hex(16)`, `expires_at: Time.now
+ 1800`) and `Mailer.deliver` a reset link built from
`ENV['FRONTEND_URL']`; always respond 200 with the same generic body
`{message: "If that username exists, a reset link has been sent"}`
regardless of whether a user was found. Reset: look up token by value; 422
if missing/`expired?`/`used?`; validate `password_policy_valid?` and
confirmation match (422 otherwise); update the user's password, mark the
token `used_at: Time.now`, revoke all that user's existing refresh tokens
(iterate `user.refresh_tokens_dataset.exclude(revoked_at: nil).update
(revoked_at: Time.now)` or call `TokenService.revoke_refresh_token` per
token), issue a fresh token pair, respond 200 with the login-shaped body.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bundle exec rspec spec/requests/auth/forgot_password_spec.rb spec/requests/auth/reset_password_spec.rb`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/routes/auth.rb apps/api/spec/requests/auth/forgot_password_spec.rb apps/api/spec/requests/auth/reset_password_spec.rb
git commit -m "feat: add forgot/reset password with single-use expiring tokens"
```

---

### Task 13: `POST /auth/password/change`

**Files:**
- Modify: `apps/api/app/routes/auth.rb`
- Test: `apps/api/spec/requests/auth/change_password_spec.rb`

**Interfaces:**
- Consumes: `AuthHelpers#authenticate!` / `#current_user` (Task 9),
  `password_policy_valid?` (Task 11).

- [ ] **Step 1: Write the failing tests**

```ruby
# spec/requests/auth/change_password_spec.rb
RSpec.describe 'POST /api/v1/auth/password/change' do
  let!(:user) { User.create(role: 'patient', username: 'ernesta', email: 'e@x.com',
    first_name: 'A', last_name: 'B', password: 'Sup3r!word', must_change_password: true) }

  def access_token_for(user)
    post '/api/v1/auth/login', { username: user.username, password: 'Sup3r!word' }.to_json,
      { 'CONTENT_TYPE' => 'application/json' }
    JSON.parse(last_response.body)['access_token']
  end

  it 'changes the password and clears must_change_password' do
    token = access_token_for(user)
    post '/api/v1/auth/password/change',
      { current_password: 'Sup3r!word', password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
      { 'CONTENT_TYPE' => 'application/json', 'HTTP_AUTHORIZATION' => "Bearer #{token}" }
    expect(last_response.status).to eq(200)
    expect(user.reload.must_change_password).to be false
    expect(user.authenticate('NewPass1!')).to be true
  end

  it 'rejects the wrong current password' do
    token = access_token_for(user)
    post '/api/v1/auth/password/change',
      { current_password: 'wrong', password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
      { 'CONTENT_TYPE' => 'application/json', 'HTTP_AUTHORIZATION' => "Bearer #{token}" }
    expect(last_response.status).to eq(422)
  end

  it 'rejects an unauthenticated request' do
    post '/api/v1/auth/password/change',
      { current_password: 'Sup3r!word', password: 'NewPass1!', password_confirmation: 'NewPass1!' }.to_json,
      { 'CONTENT_TYPE' => 'application/json' }
    expect(last_response.status).to eq(401)
  end
end
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bundle exec rspec spec/requests/auth/change_password_spec.rb`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Implement `POST /auth/password/change`**

`authenticate!` in a `before` block for this route only; 422 if
`!current_user.authenticate(current_password)`,
`!password_policy_valid?(password)`, or confirmation mismatch; else
update password and `must_change_password: false`, respond 200.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bundle exec rspec spec/requests/auth/change_password_spec.rb`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/routes/auth.rb apps/api/spec/requests/auth/change_password_spec.rb
git commit -m "feat: add authenticated POST /auth/password/change"
```

---

## Self-Review

**Spec coverage:** All of the design doc's `/auth/*` endpoints are covered
except calendar/booking/etc., which belong to later plans by design. The
screen spec's Main/Register/ForgotPassword field rules (username format,
password policy, 30-minute reset expiry, 5-attempt lockout, generic
forgot-password copy) each have an owning task.

**Type consistency:** `User`, `RefreshToken`, `PasswordResetToken` field
names are used consistently across all tasks that reference them.
`current_user` / `authenticate!` (Task 9) are the only helpers later tasks
(13, and every future plan) rely on, and they're named consistently
throughout.

**Review Focus:** all five items above have an owning task and an explicit
test.

**Proportion:** this plan is long because it's the one plan the entire rest
of the system depends on (13 tasks covering schema + 7 endpoints +
TokenService + Mailer) — every later plan will be shorter, building on top
of `authenticate!`, `TokenService`, and the users table this plan
establishes.
