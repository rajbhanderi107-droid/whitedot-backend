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

/* ── Directory (ADMIN+) ─────────────────────────────────────── */

export async function listEmployees(_req: Request, res: Response) {
  const users = await prisma.user.findMany({
    where: { role: "EMPLOYEE" },
    orderBy: { name: "asc" },
    select: {
      ...USER_FIELDS,
      employeeProfile: true,
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
      employeeProfile: true,
      workTasks: { orderBy: { createdAt: "desc" } },
      leaveRequests: { orderBy: { createdAt: "desc" } },
      attendanceDays: { orderBy: { date: "desc" }, take: 14 },
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
          location: (body.location as string) ?? null,
          type: (body.type as never) ?? "FULL_TIME",
          status: (body.status as never) ?? "ACTIVE",
          joinedAt: body.joinedAt ? new Date(String(body.joinedAt)) : undefined,
          manager: (body.manager as string) ?? null,
          salary: typeof body.salary === "number" ? body.salary : 0,
          kpi: typeof body.kpi === "number" ? body.kpi : 75,
          tools: Array.isArray(body.tools) ? (body.tools as string[]) : [],
          workspace: (body.workspace as string) ?? null,
          notes: (body.notes as string) ?? null,
          avatarHue: typeof body.avatarHue === "number" ? body.avatarHue : 150,
        },
      },
    },
    select: { ...USER_FIELDS, employeeProfile: true },
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

  const profileData: Record<string, unknown> = {};
  for (const k of ["location", "type", "status", "manager", "salary", "kpi", "tools", "workspace", "notes", "avatarHue", "annual", "sick", "casual"] as const) {
    if (k in body) profileData[k] = body[k];
  }
  if ("joinedAt" in body && body.joinedAt) profileData.joinedAt = new Date(String(body.joinedAt));

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
    select: { ...USER_FIELDS, employeeProfile: true },
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
      employeeProfile: true,
      workTasks: { orderBy: { createdAt: "desc" } },
      leaveRequests: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!user) throw new AppError(404, "NOT_FOUND", "Not found");
  return sendSuccess(res, user);
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
