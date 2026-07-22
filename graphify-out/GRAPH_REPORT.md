# Graph Report - .  (2026-07-22)

## Corpus Check
- 143 files · ~62,882 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1574 nodes · 2927 edges · 73 communities (69 shown, 4 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 112 edges (avg confidence: 0.6)
- Token cost: 150 input · 590 output

## Community Hubs (Navigation)
- Current Edge API
- Published Edge API
- Reviewed Edge API
- Published Activity Invites
- Reviewed Activity Invites
- Current Activity Invites
- Reviewed Evaluation Flow
- Published Evaluation Flow
- Reviewed Admin Authentication
- Current Evaluation Flow
- Published Admin Authentication
- Current Admin Authentication
- Published Package Dependencies
- Current Package Dependencies
- Reviewed Package Dependencies
- Published Organization Management
- Reviewed Organization Management
- Published Employee Management
- Reviewed Employee Management
- Current Employee Management
- Published Invite Codes
- Published TypeScript Config
- Reviewed Invite Codes
- Reviewed TypeScript Config
- Current Invite Codes
- Current TypeScript Config
- Published Task Management
- Published User Management
- Reviewed Task Management
- Reviewed User Management
- Current Task Management
- Current Activity Periods
- Current User Management
- Published Dashboard Results
- Reviewed Dashboard Results
- Current Dashboard Results
- Current Organization Management
- Published Activity Periods
- Published Scoring Rules
- Reviewed Activity Periods
- Reviewed Scoring Rules
- Current Scoring Rules
- Published Public Entry
- Reviewed Public Entry
- Current Public Entry
- Published Data Operations
- Current Data Operations
- Reviewed Data Operations
- Published Application Routing
- Reviewed Application Routing
- Current Application Routing
- EdgeOne Deployment Guides
- Product Architecture Memory
- Repository Build Guidelines
- Security Lifecycle Review
- Legacy Deployment Fixes
- Evaluation Business Rules
- Published Fairness Icon
- Reviewed Mock KV
- Original Product Prompt
- Published Female Avatar
- Reviewed Female Avatar
- Reviewed Male Avatar
- Published Male Avatar
- Current Female Avatar
- Current Male Avatar
- Current Fairness Icon
- Published Vue Types
- Reviewed Vue Types
- Current Vue Types

## God Nodes (most connected - your core abstractions)
1. `adminRoutes()` - 55 edges
2. `adminRoutes()` - 55 edges
3. `adminRoutes()` - 55 edges
4. `unwrap()` - 41 edges
5. `unwrap()` - 41 edges
6. `unwrap()` - 41 edges
7. `httpError()` - 21 edges
8. `publicRoutes()` - 21 edges
9. `runBatchAction()` - 21 edges
10. `publicRoutes()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `EdgeOne Pages Deployment v1.2.4` --semantically_similar_to--> `EdgeOne Pages Deployment v1.2.0`  [INFERRED] [semantically similar]
  EDGEONE_DEPLOYMENT.md → EDGEONE_DEPLOYMENT(2).md
- `Published EdgeOne Deployment Guide` --semantically_similar_to--> `EdgeOne Pages Deployment v1.2.4`  [INFERRED] [semantically similar]
  _github_publish/EDGEONE_DEPLOYMENT.md → EDGEONE_DEPLOYMENT.md
- `Published Repository Guidelines` --semantically_similar_to--> `Lumirror Repository Guidelines`  [INFERRED] [semantically similar]
  _github_publish/AGENTS.md → AGENTS.md
- `Reviewed EdgeOne Deployment Guide v1.2.4` --semantically_similar_to--> `EdgeOne Pages Deployment v1.2.4`  [INFERRED] [semantically similar]
  _review_v124/EDGEONE_DEPLOYMENT.md → EDGEONE_DEPLOYMENT.md
- `Published Lumirror README` --semantically_similar_to--> `Lumirror README`  [INFERRED] [semantically similar]
  _github_publish/README.md → README.md

## Import Cycles
- None detected.

## Communities (73 total, 4 thin omitted)

### Community 0 - "Current Edge API"
Cohesion: 0.05
Nodes (113): activityStatus(), activityView(), addVerifyCodesAndTasks(), adminCookie(), adminRoutes(), adminSecret(), adminTokenFromRequest(), appendLog() (+105 more)

### Community 1 - "Published Edge API"
Cohesion: 0.05
Nodes (113): activityStatus(), activityView(), addVerifyCodesAndTasks(), adminCookie(), adminRoutes(), adminSecret(), adminTokenFromRequest(), appendLog() (+105 more)

### Community 2 - "Reviewed Edge API"
Cohesion: 0.05
Nodes (114): activityStatus(), activityView(), addVerifyCodesAndTasks(), adminCookie(), adminRoutes(), adminSecret(), adminTokenFromRequest(), appendLog() (+106 more)

### Community 3 - "Published Activity Invites"
Cohesion: 0.06
Nodes (30): activityColumns, batchRemove(), batchStatus(), canWrite, columns, copy(), createFlow(), createTimedLink() (+22 more)

### Community 4 - "Reviewed Activity Invites"
Cohesion: 0.06
Nodes (30): activityColumns, batchRemove(), batchStatus(), canWrite, columns, copy(), createFlow(), createTimedLink() (+22 more)

### Community 5 - "Current Activity Invites"
Cohesion: 0.06
Nodes (30): activityColumns, batchRemove(), batchStatus(), canWrite, columns, copy(), createFlow(), createTimedLink() (+22 more)

### Community 6 - "Reviewed Evaluation Flow"
Cohesion: 0.07
Nodes (27): ApiError, calculateScore(), ruleFormula(), ApiResult, BackendRole, Employee, EvaluationTask, ScoreRule (+19 more)

### Community 7 - "Published Evaluation Flow"
Cohesion: 0.07
Nodes (26): ApiError, calculateScore(), ruleFormula(), ApiResult, BackendRole, Employee, EvaluationTask, ScoreRule (+18 more)

### Community 8 - "Reviewed Admin Authentication"
Cohesion: 0.08
Nodes (29): allGroups, collapsed, groups, loadMe(), logout(), mobileOpen, route, router (+21 more)

### Community 9 - "Current Evaluation Flow"
Cohesion: 0.07
Nodes (26): ApiError, calculateScore(), ruleFormula(), ApiResult, BackendRole, Employee, EvaluationTask, ScoreRule (+18 more)

### Community 10 - "Published Admin Authentication"
Cohesion: 0.09
Nodes (28): allGroups, collapsed, groups, loadMe(), logout(), mobileOpen, route, router (+20 more)

### Community 11 - "Current Admin Authentication"
Cohesion: 0.09
Nodes (28): allGroups, collapsed, groups, loadMe(), logout(), mobileOpen, route, router (+20 more)

### Community 12 - "Published Package Dependencies"
Cohesion: 0.07
Nodes (29): dependencies, element-plus, @element-plus/icons-vue, vue, vue-router, devDependencies, typescript, vite (+21 more)

### Community 13 - "Current Package Dependencies"
Cohesion: 0.07
Nodes (29): dependencies, element-plus, @element-plus/icons-vue, vue, vue-router, devDependencies, typescript, vite (+21 more)

### Community 14 - "Reviewed Package Dependencies"
Cohesion: 0.07
Nodes (28): dependencies, element-plus, @element-plus/icons-vue, vue, vue-router, devDependencies, typescript, vite (+20 more)

### Community 15 - "Published Organization Management"
Cohesion: 0.10
Nodes (21): BatchAction, BatchResult, reasonText(), runBatchAction(), showBatchResult(), batchRemove(), batchStatus(), canWrite (+13 more)

### Community 16 - "Reviewed Organization Management"
Cohesion: 0.10
Nodes (21): BatchAction, BatchResult, reasonText(), runBatchAction(), showBatchResult(), batchRemove(), batchStatus(), canWrite (+13 more)

### Community 17 - "Published Employee Management"
Cohesion: 0.11
Nodes (20): batchRemove(), batchStatus(), canWrite, columns, dialog, employeeColumns, filters, filterTeams (+12 more)

### Community 18 - "Reviewed Employee Management"
Cohesion: 0.11
Nodes (20): batchRemove(), batchStatus(), canWrite, columns, dialog, employeeColumns, filters, filterTeams (+12 more)

### Community 19 - "Current Employee Management"
Cohesion: 0.11
Nodes (20): batchRemove(), batchStatus(), canWrite, columns, dialog, employeeColumns, filters, filterTeams (+12 more)

### Community 20 - "Published Invite Codes"
Cohesion: 0.10
Nodes (19): activities, batchRemove(), canWrite, columns, dialog, employees, form, generate() (+11 more)

### Community 21 - "Published TypeScript Config"
Cohesion: 0.09
Nodes (22): compilerOptions, esModuleInterop, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+14 more)

### Community 22 - "Reviewed Invite Codes"
Cohesion: 0.10
Nodes (19): activities, batchRemove(), canWrite, columns, dialog, employees, form, generate() (+11 more)

### Community 23 - "Reviewed TypeScript Config"
Cohesion: 0.09
Nodes (22): compilerOptions, esModuleInterop, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+14 more)

### Community 24 - "Current Invite Codes"
Cohesion: 0.10
Nodes (19): activities, batchRemove(), canWrite, columns, dialog, employees, form, generate() (+11 more)

### Community 25 - "Current TypeScript Config"
Cohesion: 0.09
Nodes (22): compilerOptions, esModuleInterop, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+14 more)

### Community 26 - "Published Task Management"
Cohesion: 0.12
Nodes (18): emit, updateValue(), ColumnOption, useColumnSettings(), reset(), activities, batchRemove(), canWrite (+10 more)

### Community 27 - "Published User Management"
Cohesion: 0.11
Nodes (16): batchRemove(), batchStatus(), columns, dialog, filteredEmployees, filteredTeams, form, load() (+8 more)

### Community 28 - "Reviewed Task Management"
Cohesion: 0.12
Nodes (18): emit, updateValue(), ColumnOption, useColumnSettings(), reset(), activities, batchRemove(), canWrite (+10 more)

### Community 29 - "Reviewed User Management"
Cohesion: 0.11
Nodes (16): batchRemove(), batchStatus(), columns, dialog, filteredEmployees, filteredTeams, form, load() (+8 more)

### Community 30 - "Current Task Management"
Cohesion: 0.12
Nodes (18): emit, updateValue(), ColumnOption, useColumnSettings(), reset(), activities, batchRemove(), canWrite (+10 more)

### Community 31 - "Current Activity Periods"
Cohesion: 0.13
Nodes (17): BatchAction, BatchResult, reasonText(), runBatchAction(), showBatchResult(), Periods(), batchRemove(), batchStatus() (+9 more)

### Community 32 - "Current User Management"
Cohesion: 0.11
Nodes (16): batchRemove(), batchStatus(), columns, dialog, filteredEmployees, filteredTeams, form, load() (+8 more)

### Community 33 - "Published Dashboard Results"
Cohesion: 0.11
Nodes (14): Dashboard(), Results(), data, load(), loading, selected, teamGroups, activities (+6 more)

### Community 34 - "Reviewed Dashboard Results"
Cohesion: 0.11
Nodes (14): Dashboard(), Results(), data, load(), loading, selected, teamGroups, activities (+6 more)

### Community 35 - "Current Dashboard Results"
Cohesion: 0.11
Nodes (14): Dashboard(), Results(), data, load(), loading, selected, teamGroups, activities (+6 more)

### Community 36 - "Current Organization Management"
Cohesion: 0.12
Nodes (16): batchRemove(), batchStatus(), canWrite, departments, dialog, form, kind, load() (+8 more)

### Community 37 - "Published Activity Periods"
Cohesion: 0.16
Nodes (12): Periods(), batchRemove(), batchStatus(), canWrite, dialog, form, load(), remove() (+4 more)

### Community 38 - "Published Scoring Rules"
Cohesion: 0.12
Nodes (14): activities, enabledRules, equalAverage, evaluation, formula, load(), loading, periodName (+6 more)

### Community 39 - "Reviewed Activity Periods"
Cohesion: 0.16
Nodes (12): Periods(), batchRemove(), batchStatus(), canWrite, dialog, form, load(), remove() (+4 more)

### Community 40 - "Reviewed Scoring Rules"
Cohesion: 0.12
Nodes (14): activities, enabledRules, equalAverage, evaluation, formula, load(), loading, periodName (+6 more)

### Community 41 - "Current Scoring Rules"
Cohesion: 0.12
Nodes (14): activities, enabledRules, equalAverage, evaluation, formula, load(), loading, periodName (+6 more)

### Community 42 - "Published Public Entry"
Cohesion: 0.15
Nodes (12): enter(), enterTimed(), form, hasInviteLink, hasTimedLink, linkCode, loading, openedTimedCode (+4 more)

### Community 43 - "Reviewed Public Entry"
Cohesion: 0.15
Nodes (12): enter(), enterTimed(), form, hasInviteLink, hasTimedLink, linkCode, loading, openedTimedCode (+4 more)

### Community 44 - "Current Public Entry"
Cohesion: 0.15
Nodes (12): enter(), enterTimed(), form, hasInviteLink, hasTimedLink, linkCode, loading, openedTimedCode (+4 more)

### Community 45 - "Published Data Operations"
Cohesion: 0.23
Nodes (12): unwrap(), ImportExport(), cleaning, cleanup(), download(), downloadFull(), file, loadLogs() (+4 more)

### Community 46 - "Current Data Operations"
Cohesion: 0.23
Nodes (12): unwrap(), ImportExport(), cleaning, cleanup(), download(), downloadFull(), file, loadLogs() (+4 more)

### Community 47 - "Reviewed Data Operations"
Cohesion: 0.26
Nodes (11): unwrap(), cleaning, cleanup(), download(), downloadFull(), file, loadLogs(), logs (+3 more)

### Community 48 - "Published Application Routing"
Cohesion: 0.18
Nodes (9): AdminLayout(), Employees(), EvaluationCodes(), Organization(), router, ScoreRules(), Tasks(), Users() (+1 more)

### Community 49 - "Reviewed Application Routing"
Cohesion: 0.18
Nodes (9): Employees(), EvaluationCodes(), ImportExport(), Organization(), router, ScoreRules(), Tasks(), Users() (+1 more)

### Community 50 - "Current Application Routing"
Cohesion: 0.18
Nodes (9): AdminLayout(), Employees(), EvaluationCodes(), Organization(), router, ScoreRules(), Tasks(), Users() (+1 more)

### Community 51 - "EdgeOne Deployment Guides"
Cohesion: 0.27
Nodes (10): EdgeOne Vite Build Settings, EdgeOne Pages Deployment v1.2.4, KV Binding and Readiness Diagnostics, Functions Runtime Environment, Published EdgeOne Deployment Guide, Published Lumirror README, Lumirror README, Reviewed EdgeOne Deployment Guide v1.2.4 (+2 more)

### Community 52 - "Product Architecture Memory"
Cohesion: 0.22
Nodes (10): Lumirror Project Memory, Public and Admin Application Flows, Anonymity and KV Concurrency Risks, Role-Based Permissions, Lumirror Anonymous Evaluation Platform, Anonymous Data Minimization, Deletion and Historical Data Protection, Multi-User RBAC (+2 more)

### Community 53 - "Repository Build Guidelines"
Cohesion: 0.31
Nodes (9): Vue and EdgeOne Application Architecture, EdgeOne Source Packaging Rules, Lumirror Repository Guidelines, Required Validation Commands, Published Repository Guidelines, Published Vue HTML Entry, Vue Application Shell, Lumirror Vue HTML Entry (+1 more)

### Community 54 - "Security Lifecycle Review"
Cohesion: 0.39
Nodes (9): SEC-001 Copyable Deployment Secrets, SEC-002 Weak Password Hashing, SEC-003 Plaintext Invite Export, SEC-004 Permissive CORS, SEC-005 Admin Token Local Storage, SEC-006 Request Body Limit Bypass, SEC-007 Whole-Database KV Concurrency, Security and Lifecycle Hardening (+1 more)

### Community 55 - "Legacy Deployment Fixes"
Cohesion: 0.32
Nodes (8): Vite Production Build Configuration, EdgeOne Pages Deployment v1.2.0, EVALUATION_KV Binding, Deployment Health Verification, Production Token Secrets, EdgeOne Deployment Fix v1.0.1, GET API Health Endpoint, Edge Runtime Compatibility Fixes

### Community 56 - "Evaluation Business Rules"
Cohesion: 0.29
Nodes (7): Evaluation Business Rules, Evaluation Code and Task Lifecycle, Evaluation Regression Fixes, Lumirror v1.1.0 Release Notes, Lumirror v1.2.4 Release Notes, Score Weight Data Migration, Three-Dimension Scoring Rules

### Community 57 - "Published Fairness Icon"
Cohesion: 0.40
Nodes (5): Balance Scale Symbol, Circular Accents, Justice, Rounded Orange Background, Favicon SVG

### Community 59 - "Original Product Prompt"
Cohesion: 0.60
Nodes (5): Anonymous Evaluation Privacy Model, Public and Admin API Contract, Anonymous Employee Peer Review Development Prompt, EdgeOne KV Data Model, Evaluation and Verification Code Authentication

### Community 60 - "Published Female Avatar"
Cohesion: 0.50
Nodes (4): Circular Portrait, Default Female Avatar SVG, Female Avatar, Warm Gradient Palette

### Community 61 - "Reviewed Female Avatar"
Cohesion: 0.50
Nodes (4): Circular portrait, Default female avatar, Female character illustration, Warm gradient palette

### Community 62 - "Reviewed Male Avatar"
Cohesion: 0.50
Nodes (4): Circular portrait, Male avatar, Default male avatar SVG, Warm color palette

### Community 63 - "Published Male Avatar"
Cohesion: 0.67
Nodes (3): Circular Portrait, Default Male Avatar, Warm Gradient Palette

### Community 64 - "Current Female Avatar"
Cohesion: 1.00
Nodes (3): Circular Portrait, Female Avatar, Default Female Avatar SVG

### Community 65 - "Current Male Avatar"
Cohesion: 1.00
Nodes (3): Default Male Avatar, Default User Identity, Male Profile Avatar

### Community 66 - "Current Fairness Icon"
Cohesion: 0.67
Nodes (3): Balance Scale, Justice, Lumirror Favicon

## Knowledge Gaps
- **626 isolated node(s):** `encoder`, `decoder`, `rateBuckets`, `DEFAULT_RULES`, `ROLE_LABELS` (+621 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `unwrap()` connect `Published Data Operations` to `Published Dashboard Results`, `Published Activity Invites`, `Published Activity Periods`, `Published Scoring Rules`, `Published Evaluation Flow`, `Published Admin Authentication`, `Published Organization Management`, `Published Employee Management`, `Published Invite Codes`, `Published Task Management`, `Published User Management`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `unwrap()` connect `Current Data Operations` to `Current User Management`, `Current Dashboard Results`, `Current Organization Management`, `Current Activity Invites`, `Current Evaluation Flow`, `Current Scoring Rules`, `Current Admin Authentication`, `Current Employee Management`, `Current Invite Codes`, `Current Task Management`, `Current Activity Periods`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Why does `unwrap()` connect `Reviewed Data Operations` to `Reviewed Dashboard Results`, `Reviewed Activity Invites`, `Reviewed Evaluation Flow`, `Reviewed Activity Periods`, `Reviewed Admin Authentication`, `Reviewed Scoring Rules`, `Reviewed Organization Management`, `Reviewed Employee Management`, `Reviewed Invite Codes`, `Reviewed Task Management`, `Reviewed User Management`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **What connects `encoder`, `decoder`, `rateBuckets` to the rest of the system?**
  _626 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Current Edge API` be split into smaller, more focused modules?**
  _Cohesion score 0.05334512231063955 - nodes in this community are weakly interconnected._
- **Should `Published Edge API` be split into smaller, more focused modules?**
  _Cohesion score 0.05334512231063955 - nodes in this community are weakly interconnected._
- **Should `Reviewed Edge API` be split into smaller, more focused modules?**
  _Cohesion score 0.05349248452696728 - nodes in this community are weakly interconnected._