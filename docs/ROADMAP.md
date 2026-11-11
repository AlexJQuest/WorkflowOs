# Roadmap

## Phase 1: Discovery and planning

Status: IMPLEMENTED

- Verify repository and environment
- Document architecture recommendation
- Define MVP and backlog

## Phase 2: Environment and database foundation

Status: AUTOMATED_TESTED

- Initialize project skeleton
- Create environment template
- Add SQL migration system
- Add database schema for users, businesses, memberships, settings, products, and customers
- Add API and onboarding tests
- Configure GitHub Actions verification and gated production deployment hook
- Set up GitHub production environment and hosting provider deploy hook before enabling live deployment

## Phase 3: Authentication and onboarding

Status: IMPLEMENTED

- Registration
- Business creation
- Login and logout
- Session validation
- Persistent settings update
- Dashboard access control

## Phase 4: Application shell and business operations

Status: IN_PROGRESS

- Navigation layout
- Business context banner
- Products and customer management with tenant isolation
- Transaction-backed dashboard with sales, revenue trends, best sellers, customer activity, and low-stock alerts
- Sales recording, idempotency, stock movement ledger, and full-refund reversal
- Product detail/edit workflow, transactional stock adjustments, and history-preserving archive/restore
- Human acceptance testing and remaining business operations still outstanding

## Phase 5: Subscription and payment foundation

Status: PLANNED

- Plan records and entitlement checks
- Sandbox payment adapter
- Subscription lifecycle and restrictions

## Phase 6: Advanced modules and pilot readiness

Status: PLANNED

- Appointments, inventory, AI, and integrations
- Security review and audit planning
- Human acceptance testing
- Go-live readiness
