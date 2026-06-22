import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { validate } from "../middleware/validate.middleware.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import * as dashboard from "../controllers/dashboard.controller.js";
import * as inquiries from "../controllers/inquiry.controller.js";
import * as quotes from "../controllers/quoteRequest.controller.js";
import * as samples from "../controllers/sampleRequest.controller.js";
import * as companies from "../controllers/company.controller.js";
import * as calculator from "../controllers/calculator.controller.js";
import * as followUps from "../controllers/followUp.controller.js";
import * as documents from "../controllers/document.controller.js";
import * as settings from "../controllers/settings.controller.js";
import * as users from "../controllers/user.controller.js";
import * as attendance from "../controllers/attendance.controller.js";
import * as employees from "../controllers/employee.controller.js";
import * as workforce from "../controllers/workforce.controller.js";
import * as notifications from "../controllers/notification.controller.js";
import * as activityLog from "../controllers/activityLog.controller.js";
import * as google from "../controllers/google.controller.js";
import {
  updateInquirySchema,
  updateQuoteRequestSchema,
  updateSampleRequestSchema,
  createCompanySchema,
  updateCompanySchema,
  createAdminNoteSchema,
  createFollowUpTaskSchema,
  updateFollowUpTaskSchema,
  createDocumentSchema,
  updateWebsiteSettingSchema,
  createUserSchema,
  updateUserSchema,
  punchSchema,
  pingSchema,
  createEmployeeSchema,
  updateEmployeeSchema,
  createTaskSchema,
  updateTaskSchema,
  leaveRequestSchema,
  decideLeaveSchema,
  createDepartmentSchema,
  updateDepartmentSchema,
  createReviewSchema,
  createGoalSchema,
  updateGoalSchema,
  myGoalSchema,
  createOnboardingSchema,
  updateOnboardingSchema,
  createPayslipSchema,
  createAnnouncementSchema,
} from "../validators/admin.validator.js";

const router = Router();

// All admin routes require authentication
router.use(requireAuth);

// ─── Dashboard ───────────────────────────────────
router.get("/dashboard", asyncHandler(dashboard.getDashboard));

// ─── Google (all-in-one overview + sync) ─────────
router.get("/google/overview", asyncHandler(google.getGoogleOverview));
router.get("/google/sync-status", asyncHandler(google.getGoogleSyncStatus));
router.post("/google/sync", asyncHandler(google.triggerGoogleSync));

// ─── Inquiries ───────────────────────────────────
router.get("/inquiries", asyncHandler(inquiries.listInquiries));
router.get("/inquiries/:id", asyncHandler(inquiries.getInquiry));
router.patch("/inquiries/:id", validate(updateInquirySchema), asyncHandler(inquiries.updateInquiry));
router.delete("/inquiries/:id", requireRole("SUPER_ADMIN", "ADMIN"), asyncHandler(inquiries.deleteInquiry));
router.post("/inquiries/:id/notes", validate(createAdminNoteSchema), asyncHandler(inquiries.addInquiryNote));

// ─── Quote Requests ──────────────────────────────
router.get("/quote-requests", asyncHandler(quotes.listQuoteRequests));
router.get("/quote-requests/:id", asyncHandler(quotes.getQuoteRequest));
router.patch("/quote-requests/:id", validate(updateQuoteRequestSchema), asyncHandler(quotes.updateQuoteRequest));
router.delete("/quote-requests/:id", requireRole("SUPER_ADMIN", "ADMIN"), asyncHandler(quotes.deleteQuoteRequest));

// ─── Sample Requests ─────────────────────────────
router.get("/sample-requests", asyncHandler(samples.listSampleRequests));
router.get("/sample-requests/:id", asyncHandler(samples.getSampleRequest));
router.patch("/sample-requests/:id", validate(updateSampleRequestSchema), asyncHandler(samples.updateSampleRequest));
router.delete("/sample-requests/:id", requireRole("SUPER_ADMIN", "ADMIN"), asyncHandler(samples.deleteSampleRequest));

// ─── Companies ───────────────────────────────────
router.get("/companies", asyncHandler(companies.listCompanies));
router.get("/companies/:id", asyncHandler(companies.getCompany));
router.post("/companies", validate(createCompanySchema), asyncHandler(companies.createCompany));
router.patch("/companies/:id", validate(updateCompanySchema), asyncHandler(companies.updateCompany));
router.delete("/companies/:id", requireRole("SUPER_ADMIN", "ADMIN"), asyncHandler(companies.deleteCompany));

// ─── Calculator Submissions ──────────────────────
router.get("/calculator-submissions", asyncHandler(calculator.listCalculatorSubmissions));
router.get("/calculator-submissions/:id", asyncHandler(calculator.getCalculatorSubmission));
router.patch("/calculator-submissions/:id/convert-to-lead", asyncHandler(calculator.convertToLead));

// ─── Follow-ups ──────────────────────────────────
router.get("/follow-ups", asyncHandler(followUps.listFollowUps));
router.post("/follow-ups", validate(createFollowUpTaskSchema), asyncHandler(followUps.createFollowUp));
router.patch("/follow-ups/:id", validate(updateFollowUpTaskSchema), asyncHandler(followUps.updateFollowUp));
router.delete("/follow-ups/:id", asyncHandler(followUps.deleteFollowUp));

// ─── Documents ───────────────────────────────────
router.get("/documents", asyncHandler(documents.listDocuments));
router.post("/documents", validate(createDocumentSchema), asyncHandler(documents.createDocument));
router.patch("/documents/:id", asyncHandler(documents.updateDocument));
router.delete("/documents/:id", requireRole("SUPER_ADMIN", "ADMIN"), asyncHandler(documents.deleteDocument));

// ─── Website Settings ────────────────────────────
router.get("/website-settings", asyncHandler(settings.listSettings));
router.patch("/website-settings/:key", requireRole("SUPER_ADMIN", "ADMIN"), validate(updateWebsiteSettingSchema), asyncHandler(settings.updateSetting));

// ─── Users (SUPER_ADMIN only) ────────────────────
router.get("/users", requireRole("SUPER_ADMIN"), asyncHandler(users.listUsers));
router.post("/users", requireRole("SUPER_ADMIN"), validate(createUserSchema), asyncHandler(users.createUser));
router.patch("/users/:id", requireRole("SUPER_ADMIN"), validate(updateUserSchema), asyncHandler(users.updateUser));
router.delete("/users/:id", requireRole("SUPER_ADMIN"), asyncHandler(users.deleteUser));

// ─── Attendance & Location (digital office) ──────
// Self actions — any authenticated user (employees included) can punch & ping.
router.get("/attendance/me", asyncHandler(attendance.myAttendance));
router.post("/attendance/punch-in", validate(punchSchema), asyncHandler(attendance.punchIn));
router.post("/attendance/punch-out", validate(punchSchema), asyncHandler(attendance.punchOut));
router.post("/attendance/ping", validate(pingSchema), asyncHandler(attendance.ping));
// Attendance board — ADMIN+ (no precise location here).
router.get("/attendance/today", requireRole("SUPER_ADMIN", "ADMIN"), asyncHandler(attendance.attendanceToday));
// Location board — SUPER_ADMIN only.
router.get("/attendance/locations", requireRole("SUPER_ADMIN"), asyncHandler(attendance.liveLocations));
router.get("/attendance/locations/:userId", requireRole("SUPER_ADMIN"), asyncHandler(attendance.employeeTrail));

// ─── Workforce: employees, tasks, leave ──────────
// Self workspace (any authenticated user — employees included).
router.get("/me/workspace", asyncHandler(employees.myWorkspace));
router.post("/me/leave", validate(leaveRequestSchema), asyncHandler(employees.requestLeave));
router.get("/me/payslips", asyncHandler(employees.myPayslips));
router.patch("/me/onboarding/:id", validate(updateOnboardingSchema), asyncHandler(employees.updateMyOnboarding));
router.patch("/me/goals/:id", validate(myGoalSchema), asyncHandler(employees.updateMyGoal));
router.get("/announcements", asyncHandler(workforce.listAnnouncements));

// Directory (ADMIN+ read).
router.get("/employees", requireRole("SUPER_ADMIN", "ADMIN"), asyncHandler(employees.listEmployees));
router.get("/employees/:id", requireRole("SUPER_ADMIN", "ADMIN"), asyncHandler(employees.getEmployee));
router.post("/employees", requireRole("SUPER_ADMIN"), validate(createEmployeeSchema), asyncHandler(employees.createEmployee));
router.patch("/employees/:id", requireRole("SUPER_ADMIN"), validate(updateEmployeeSchema), asyncHandler(employees.updateEmployee));
router.post("/employees/:id/tasks", requireRole("SUPER_ADMIN", "ADMIN"), validate(createTaskSchema), asyncHandler(employees.addTask));

// Tasks — owner can move stage; admin can edit/delete (checked in controller).
router.patch("/tasks/:id", validate(updateTaskSchema), asyncHandler(employees.updateTask));
router.delete("/tasks/:id", requireRole("SUPER_ADMIN", "ADMIN"), asyncHandler(employees.deleteTask));

// Leave decisions (ADMIN+).
router.patch("/leave/:id", requireRole("SUPER_ADMIN", "ADMIN"), validate(decideLeaveSchema), asyncHandler(employees.decideLeave));

// ─── Workforce OS: overview, departments, performance, goals, onboarding, payroll, comms ──
router.get("/workforce/overview", requireRole("SUPER_ADMIN", "ADMIN"), asyncHandler(workforce.getOverview));
router.get("/departments", requireRole("SUPER_ADMIN", "ADMIN"), asyncHandler(workforce.listDepartments));
router.post("/departments", requireRole("SUPER_ADMIN"), validate(createDepartmentSchema), asyncHandler(workforce.createDepartment));
router.patch("/departments/:id", requireRole("SUPER_ADMIN"), validate(updateDepartmentSchema), asyncHandler(workforce.updateDepartment));
router.delete("/departments/:id", requireRole("SUPER_ADMIN"), asyncHandler(workforce.deleteDepartment));
router.post("/employees/:id/reviews", requireRole("SUPER_ADMIN", "ADMIN"), validate(createReviewSchema), asyncHandler(workforce.addReview));
router.post("/employees/:id/goals", requireRole("SUPER_ADMIN", "ADMIN"), validate(createGoalSchema), asyncHandler(workforce.addGoal));
router.patch("/goals/:id", requireRole("SUPER_ADMIN", "ADMIN"), validate(updateGoalSchema), asyncHandler(workforce.updateGoal));
router.delete("/goals/:id", requireRole("SUPER_ADMIN", "ADMIN"), asyncHandler(workforce.deleteGoal));
router.post("/employees/:id/onboarding", requireRole("SUPER_ADMIN", "ADMIN"), validate(createOnboardingSchema), asyncHandler(workforce.addOnboarding));
router.patch("/onboarding/:id", requireRole("SUPER_ADMIN", "ADMIN"), validate(updateOnboardingSchema), asyncHandler(workforce.updateOnboarding));
router.post("/employees/:id/payslips", requireRole("SUPER_ADMIN", "ADMIN"), validate(createPayslipSchema), asyncHandler(workforce.addPayslip));
router.post("/announcements", requireRole("SUPER_ADMIN", "ADMIN"), validate(createAnnouncementSchema), asyncHandler(workforce.createAnnouncement));
router.delete("/announcements/:id", requireRole("SUPER_ADMIN", "ADMIN"), asyncHandler(workforce.deleteAnnouncement));

// ─── Notifications ───────────────────────────────
router.get("/notifications", asyncHandler(notifications.listNotifications));
router.patch("/notifications/:id/read", asyncHandler(notifications.markRead));
router.patch("/notifications/read-all", asyncHandler(notifications.markAllRead));

// ─── Activity Log (ADMIN+) ───────────────────────
router.get("/activity-log", requireRole("SUPER_ADMIN", "ADMIN"), asyncHandler(activityLog.listActivityLogs));
router.delete("/activity-log", requireRole("SUPER_ADMIN"), asyncHandler(activityLog.deleteAllActivityLogs));
router.delete("/activity-log/:id", requireRole("SUPER_ADMIN"), asyncHandler(activityLog.deleteActivityLog));

export default router;
