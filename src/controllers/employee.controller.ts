import type { Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { hashPassword } from "../utils/password.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { logActivity } from "../services/activity.service.js";
import { AppError } from "../middleware/error.middleware.js";
import { paramId } from "../utils/params.js";

const USER_FIELDS = {
  id: true, name: true, email: true, role: true, isActive: true,
  jobTitle: true, department: true, phone: true, createdAt: true,
} as const;

function isAdmin(req: Request): boolean {
  return req.currentUser?.role === "SUPER_ADMIN" || req.currentUser?.role === "ADMIN";
}

/** Default onboarding checklist seeded on hire. */
const DEFAULT_ONBOARDING = [
  "Sign employment contract",
  "Submit ID & tax documents",
  "Set up work email & tools access",
  "Complete company & safety orientation",
  "Meet your manager & team",
];

/** Extended HR profile fields accepted from create/update bodies. */
const PROFILE_STRING_FIELDS = [
  "location", "manager", "workspace", "notes",
  "employeeCode", "departmentId", "gender", "address",
  "emergencyName", "emergencyPhone", "bloodGroup",
  "bankName", "bankAccount", "ifsc", "taxId", "currency", "payFrequency",
] as const;
const PROFILE_INT_FIELDS = ["salary", "kpi", "avatarHue", "annual", "sick", "casual", "weeklyHours"] as const;
const PROFILE_DATE_FIELDS = ["joinedAt", "dateOfBirth", "probationEndsAt", "contractEndsAt"] as const;
const PROFILE_ENUM_FIELDS = ["type", "status"] as const;

/** Build a Prisma EmployeeProfile data object from a request body. */
function buildProfileData(body: Record<string, unknown>, mode: "create" | "update"): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const k of PROFILE_STRING_FIELDS) if (k in body) data[k] = (body[k] as string) ?? null;
  for (const k of PROFILE_INT_FIELDS) if (k in body && typeof body[k] === "number") data[k] = body[k];
  for (const k of PROFILE_ENUM_FIELDS) if (k in body && body[k]) data[k] = body[k];
  for (const k of PROFILE_DATE_FIELDS) {
    if (k in body) data[k] = body[k] ? new Date(String(body[k])) : null;
  }
  // tools array
  if (Array.isArray(body.tools)) data.tools = body.tools as string[];
  // On create, never write null joinedAt (column is NOT NULL with default).
  if (mode === "create" && data.joinedAt == null) delete data.joinedAt;
  return data;
}

const PROFILE_DETAIL = {
  include: { dept: { select: { id: true, name: true, code: true } } },
} as const;

/* ── Directory (ADMIN+) ─────────────────────────────────────── */

export async function listEmployees(_req: Request, res: Response) {
  const users = await prisma.user.findMany({
    where: { role: "EMPLOYEE" },
    orderBy: { name: "asc" },
    select: {
      ...USER_FIELDS,
      employeeProfile: PROFILE_DETAIL,
      _count: { select: { workTasks: true } },
    },
  });

  // Count done tasks per user in one grouped query.
  const done = await prisma.workTask.groupBy({
    by: ["userId"],
    where: { stage: "DONE", userId: { in: users.map((u) => u.id) } },
    _count: { _all: true },
  });
  const doneMap = new Map(done.map((d) => [d.userId, d._count._all]));

  const employees = users.map((u) => ({
    ...u,
    tasksTotal: u._count.workTasks,
    tasksDone: doneMap.get(u.id) ?? 0,
  }));

  return sendSuccess(res, employees);
}

/** Full employee record — profile, tasks, leave, recent attendance. */
export async function getEmployee(req: Request, res: Response) {
  const id = paramId(req);
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      ...USER_FIELDS,
      employeeProfile: PROFILE_DETAIL,
      workTasks: { orderBy: { createdAt: "desc" } },
      leaveRequests: { orderBy: { createdAt: "desc" } },
      attendanceDays: { orderBy: { date: "desc" }, take: 14 },
      reviewsReceived: { orderBy: { createdAt: "desc" } },
      goals: { orderBy: { createdAt: "desc" } },
      onboardingTasks: { orderBy: { order: "asc" } },
      payslips: { orderBy: { month: "desc" } },
    },
  });
  if (!user) throw new AppError(404, "EMPLOYEE_NOT_FOUND", "Employee not found");
  return sendSuccess(res, user);
}

/** Create a real employee account (User + profile). SUPER_ADMIN only. */
export async function createEmployee(req: Request, res: Response) {
  const body = req.body as Record<string, unknown>;
  const email = String(body.email);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AppError(409, "EMAIL_EXISTS", "A user with this email already exists");

  const passwordHash = await hashPassword(String(body.password));

  const profileData = buildProfileData(body, "create");

  const user = await prisma.user.create({
    data: {
      name: String(body.name),
      email,
      passwordHash,
      role: "EMPLOYEE",
      jobTitle: (body.jobTitle as string) ?? null,
      department: (body.department as string) ?? null,
      phone: (body.phone as string) ?? null,
      employeeProfile: {
        create: {
          type: (body.type as never) ?? "FULL_TIME",
          status: (body.status as never) ?? "ACTIVE",
          salary: typeof body.salary === "number" ? body.salary : 0,
          kpi: typeof body.kpi === "number" ? body.kpi : 75,
          tools: Array.isArray(body.tools) ? (body.tools as string[]) : [],
          avatarHue: typeof body.avatarHue === "number" ? body.avatarHue : 150,
          ...profileData,
        },
      },
      onboardingTasks: {
        create: DEFAULT_ONBOARDING.map((label, order) => ({ label, order })),
      },
    },
    select: { ...USER_FIELDS, employeeProfile: PROFILE_DETAIL },
  });

  await logActivity({ userId: req.currentUser!.id, action: "CREATE_EMPLOYEE", entityType: "USER", entityId: user.id });
  return sendSuccess(res, user, "Employee created", 201);
}

/** Update employee user fields + profile. SUPER_ADMIN only. */
export async function updateEmployee(req: Request, res: Response) {
  const id = paramId(req);
  const body = req.body as Record<string, unknown>;

  const userData: Record<string, unknown> = {};
  for (const k of ["name", "jobTitle", "department", "phone", "isActive"] as const) {
    if (k in body) userData[k] = body[k];
  }

  const profileData = buildProfileData(body, "update");

  const user = await prisma.user.update({
    where: { id },
    data: {
      ...userData,
      employeeProfile: {
        upsert: {
          create: profileData,
          update: profileData,
        },
      },
    },
    select: { ...USER_FIELDS, employeeProfile: PROFILE_DETAIL },
  });

  await logActivity({ userId: req.currentUser!.id, action: "UPDATE_EMPLOYEE", entityType: "USER", entityId: id });
  return sendSuccess(res, user, "Employee updated");
}

/* ── My workspace (self) ────────────────────────────────────── */

export async function myWorkspace(req: Request, res: Response) {
  const id = req.currentUser!.id;
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      ...USER_FIELDS,
      employeeProfile: PROFILE_DETAIL,
      workTasks: { orderBy: { createdAt: "desc" } },
      leaveRequests: { orderBy: { createdAt: "desc" } },
      goals: { orderBy: { createdAt: "desc" } },
      onboardingTasks: { orderBy: { order: "asc" } },
      payslips: { orderBy: { month: "desc" } },
      reviewsReceived: { orderBy: { createdAt: "desc" } },
      attendanceDays: { orderBy: { date: "desc" }, take: 14 },
    },
  });
  if (!user) throw new AppError(404, "NOT_FOUND", "Not found");
  return sendSuccess(res, user);
}

/** Own payslips. */
export async function myPayslips(req: Request, res: Response) {
  const payslips = await prisma.payslip.findMany({
    where: { userId: req.currentUser!.id },
    orderBy: { month: "desc" },
  });
  return sendSuccess(res, payslips);
}

/** Employee ticks one of their own onboarding items. */
export async function updateMyOnboarding(req: Request, res: Response) {
  const id = paramId(req);
  const task = await prisma.onboardingTask.findUnique({ where: { id } });
  if (!task || task.userId !== req.currentUser!.id) throw new AppError(404, "NOT_FOUND", "Onboarding item not found");
  const done = Boolean((req.body as { done: boolean }).done);
  const updated = await prisma.onboardingTask.update({ where: { id }, data: { done } });
  return sendSuccess(res, updated, "Onboarding updated");
}

/** Employee updates progress on their own goal. */
export async function updateMyGoal(req: Request, res: Response) {
  const id = paramId(req);
  const goal = await prisma.goal.findUnique({ where: { id } });
  if (!goal || goal.userId !== req.currentUser!.id) throw new AppError(404, "NOT_FOUND", "Goal not found");
  const progress = Number((req.body as { progress: number }).progress);
  const updated = await prisma.goal.update({
    where: { id },
    data: { progress, status: progress >= 100 ? "COMPLETED" : "ACTIVE" },
  });
  return sendSuccess(res, updated, "Goal updated");
}

/* ── Tasks ──────────────────────────────────────────────────── */

export async function addTask(req: Request, res: Response) {
  if (!isAdmin(req)) throw new AppError(403, "FORBIDDEN", "Only admins can assign tasks");
  const userId = paramId(req);
  const body = req.body as Record<string, unknown>;

  const task = await prisma.workTask.create({
    data: {
      userId,
      title: String(body.title),
      project: (body.project as string) ?? null,
      priority: (body.priority as never) ?? "MEDIUM",
      stage: (body.stage as never) ?? "TODO",
      due: body.due ? new Date(String(body.due)) : null,
    },
  });
  await logActivity({ userId: req.currentUser!.id, action: "ASSIGN_TASK", entityType: "USER", entityId: userId, metadata: { taskId: task.id } });
  return sendSuccess(res, task, "Task assigned", 201);
}

/** Admin can edit any field; the task owner may only move its stage. */
export async function updateTask(req: Request, res: Response) {
  const taskId = paramId(req);
  const body = req.body as Record<string, unknown>;

  const task = await prisma.workTask.findUnique({ where: { id: taskId } });
  if (!task) throw new AppError(404, "TASK_NOT_FOUND", "Task not found");

  const admin = isAdmin(req);
  const owner = task.userId === req.currentUser!.id;
  if (!admin && !owner) throw new AppError(403, "FORBIDDEN", "Not your task");

  const data: Record<string, unknown> = {};
  if ("stage" in body) data.stage = body.stage; // both admin & owner
  if (admin) {
    for (const k of ["title", "project", "priority"] as const) if (k in body) data[k] = body[k];
    if ("due" in body) data.due = body.due ? new Date(String(body.due)) : null;
  }

  const updated = await prisma.workTask.update({ where: { id: taskId }, data });
  return sendSuccess(res, updated, "Task updated");
}

export async function deleteTask(req: Request, res: Response) {
  if (!isAdmin(req)) throw new AppError(403, "FORBIDDEN", "Only admins can delete tasks");
  const taskId = paramId(req);
  await prisma.workTask.delete({ where: { id: taskId } });
  return sendSuccess(res, { id: taskId }, "Task deleted");
}

/* ── Leave ──────────────────────────────────────────────────── */

/** Employee requests leave for themselves. */
export async function requestLeave(req: Request, res: Response) {
  const body = req.body as Record<string, unknown>;
  const from = new Date(String(body.fromDate));
  const to = new Date(String(body.toDate));
  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000) + 1);

  const leave = await prisma.leaveRequest.create({
    data: {
      userId: req.currentUser!.id,
      type: body.type as never,
      fromDate: from,
      toDate: to,
      days,
      reason: (body.reason as string) ?? null,
    },
  });
  await logActivity({ userId: req.currentUser!.id, action: "REQUEST_LEAVE", entityType: "USER", entityId: req.currentUser!.id, metadata: { leaveId: leave.id, days } });
  return sendSuccess(res, leave, "Leave requested", 201);
}

/** Admin approves/rejects. On approval, the used-leave balance is incremented. */
export async function decideLeave(req: Request, res: Response) {
  if (!isAdmin(req)) throw new AppError(403, "FORBIDDEN", "Only admins decide leave");
  const leaveId = paramId(req);
  const status = (req.body as { status: "APPROVED" | "REJECTED" }).status;

  const leave = await prisma.leaveRequest.findUnique({ where: { id: leaveId } });
  if (!leave) throw new AppError(404, "LEAVE_NOT_FOUND", "Leave request not found");
  if (leave.status !== "PENDING") throw new AppError(400, "ALREADY_DECIDED", "This request was already decided");

  const updated = await prisma.leaveRequest.update({
    where: { id: leaveId },
    data: { status, decidedAt: new Date() },
  });

  if (status === "APPROVED") {
    const field = leave.type === "ANNUAL" ? "usedAnnual" : leave.type === "SICK" ? "usedSick" : "usedCasual";
    await prisma.employeeProfile.updateMany({
      where: { userId: leave.userId },
      data: { [field]: { increment: leave.days } },
    });
  }

  await logActivity({ userId: req.currentUser!.id, action: "DECIDE_LEAVE", entityType: "USER", entityId: leave.userId, metadata: { leaveId, status } });
  return sendSuccess(res, updated, `Leave ${status.toLowerCase()}`);
}
