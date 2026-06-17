/* Workforce OS — departments, performance, goals, onboarding, payroll, announcements. */
import type { Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { logActivity } from "../services/activity.service.js";
import { AppError } from "../middleware/error.middleware.js";
import { paramId } from "../utils/params.js";

function isAdmin(req: Request): boolean {
  return req.currentUser?.role === "SUPER_ADMIN" || req.currentUser?.role === "ADMIN";
}

/* ── Workforce overview (ADMIN+) ─────────────────────────────── */

export async function getOverview(_req: Request, res: Response) {
  // Office-local date (YYYY-MM-DD, Asia/Kolkata) — matches AttendanceDay.date strings.
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  const [headcount, active, onLeave, byStatus, byType, presentToday, pendingLeave, openTasks, byDeptRaw, departments] =
    await Promise.all([
      prisma.user.count({ where: { role: "EMPLOYEE" } }),
      prisma.employeeProfile.count({ where: { status: "ACTIVE" } }),
      prisma.employeeProfile.count({ where: { status: "ON_LEAVE" } }),
      prisma.employeeProfile.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.employeeProfile.groupBy({ by: ["type"], _count: { _all: true } }),
      prisma.attendanceDay.count({ where: { date: todayStr, status: { in: ["PRESENT", "LATE", "WFH"] } } }),
      prisma.leaveRequest.count({ where: { status: "PENDING" } }),
      prisma.workTask.count({ where: { stage: { not: "DONE" } } }),
      prisma.employeeProfile.groupBy({ by: ["departmentId"], _count: { _all: true } }),
      prisma.department.findMany({ select: { id: true, name: true } }),
    ]);

  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const byDepartment = byDeptRaw.map((r) => ({
    departmentId: r.departmentId,
    department: r.departmentId ? deptName.get(r.departmentId) ?? "Unknown" : "Unassigned",
    count: r._count._all,
  }));

  return sendSuccess(res, {
    headcount,
    active,
    onLeave,
    presentToday,
    pendingLeave,
    openTasks,
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
    byType: byType.map((t) => ({ type: t.type, count: t._count._all })),
    byDepartment,
  });
}

/* ── Departments (ADMIN read; SUPER_ADMIN write) ─────────────── */

export async function listDepartments(_req: Request, res: Response) {
  const depts = await prisma.department.findMany({
    orderBy: { name: "asc" },
    include: {
      head: { select: { id: true, name: true } },
      _count: { select: { employees: true } },
    },
  });
  const result = depts.map((d) => ({
    id: d.id,
    name: d.name,
    code: d.code,
    description: d.description,
    headId: d.headId,
    headName: d.head?.name ?? null,
    employeeCount: d._count.employees,
    createdAt: d.createdAt,
  }));
  return sendSuccess(res, result);
}

export async function createDepartment(req: Request, res: Response) {
  const body = req.body as Record<string, unknown>;
  const existing = await prisma.department.findUnique({ where: { name: String(body.name) } });
  if (existing) throw new AppError(409, "DEPT_EXISTS", "A department with this name already exists");
  const dept = await prisma.department.create({
    data: {
      name: String(body.name),
      code: (body.code as string) ?? null,
      description: (body.description as string) ?? null,
      headId: (body.headId as string) ?? null,
    },
  });
  await logActivity({ userId: req.currentUser!.id, action: "CREATE_DEPARTMENT", entityType: "USER", entityId: dept.id });
  return sendSuccess(res, dept, "Department created", 201);
}

export async function updateDepartment(req: Request, res: Response) {
  const id = paramId(req);
  const body = req.body as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const k of ["name", "code", "description", "headId"] as const) if (k in body) data[k] = body[k] ?? null;
  const dept = await prisma.department.update({ where: { id }, data });
  await logActivity({ userId: req.currentUser!.id, action: "UPDATE_DEPARTMENT", entityType: "USER", entityId: id });
  return sendSuccess(res, dept, "Department updated");
}

export async function deleteDepartment(req: Request, res: Response) {
  const id = paramId(req);
  const count = await prisma.employeeProfile.count({ where: { departmentId: id } });
  if (count > 0) throw new AppError(409, "DEPT_NOT_EMPTY", `Reassign the ${count} employee(s) in this department first`);
  await prisma.department.delete({ where: { id } });
  await logActivity({ userId: req.currentUser!.id, action: "DELETE_DEPARTMENT", entityType: "USER", entityId: id });
  return sendSuccess(res, { id }, "Department deleted");
}

/* ── Performance reviews (ADMIN+) ────────────────────────────── */

export async function addReview(req: Request, res: Response) {
  const userId = paramId(req);
  const body = req.body as Record<string, unknown>;
  const review = await prisma.performanceReview.create({
    data: {
      userId,
      period: String(body.period),
      rating: Number(body.rating),
      strengths: (body.strengths as string) ?? null,
      improvements: (body.improvements as string) ?? null,
      reviewerId: req.currentUser!.id,
    },
  });
  await logActivity({ userId: req.currentUser!.id, action: "ADD_REVIEW", entityType: "USER", entityId: userId });
  return sendSuccess(res, review, "Review added", 201);
}

/* ── Goals (ADMIN+ create/update/delete) ─────────────────────── */

export async function addGoal(req: Request, res: Response) {
  const userId = paramId(req);
  const body = req.body as Record<string, unknown>;
  const goal = await prisma.goal.create({
    data: {
      userId,
      title: String(body.title),
      description: (body.description as string) ?? null,
      dueDate: body.dueDate ? new Date(String(body.dueDate)) : null,
    },
  });
  return sendSuccess(res, goal, "Goal added", 201);
}

export async function updateGoal(req: Request, res: Response) {
  const id = paramId(req);
  const body = req.body as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const k of ["title", "description", "progress", "status"] as const) if (k in body) data[k] = body[k];
  if ("dueDate" in body) data.dueDate = body.dueDate ? new Date(String(body.dueDate)) : null;
  const goal = await prisma.goal.update({ where: { id }, data });
  return sendSuccess(res, goal, "Goal updated");
}

export async function deleteGoal(req: Request, res: Response) {
  const id = paramId(req);
  await prisma.goal.delete({ where: { id } });
  return sendSuccess(res, { id }, "Goal deleted");
}

/* ── Onboarding (ADMIN+ add; PATCH shared with self) ─────────── */

export async function addOnboarding(req: Request, res: Response) {
  const userId = paramId(req);
  const body = req.body as Record<string, unknown>;
  const task = await prisma.onboardingTask.create({
    data: {
      userId,
      label: String(body.label),
      order: typeof body.order === "number" ? body.order : 0,
    },
  });
  return sendSuccess(res, task, "Onboarding item added", 201);
}

export async function updateOnboarding(req: Request, res: Response) {
  if (!isAdmin(req)) throw new AppError(403, "FORBIDDEN", "Admins only");
  const id = paramId(req);
  const done = Boolean((req.body as { done: boolean }).done);
  const task = await prisma.onboardingTask.update({ where: { id }, data: { done } });
  return sendSuccess(res, task, "Onboarding updated");
}

/* ── Payroll (ADMIN+) ────────────────────────────────────────── */

export async function addPayslip(req: Request, res: Response) {
  const userId = paramId(req);
  const body = req.body as Record<string, unknown>;
  const gross = Number(body.gross);
  const deductions = typeof body.deductions === "number" ? body.deductions : 0;
  const month = String(body.month);

  const existing = await prisma.payslip.findUnique({ where: { userId_month: { userId, month } } });
  if (existing) throw new AppError(409, "PAYSLIP_EXISTS", `A payslip for ${month} already exists`);

  const profile = await prisma.employeeProfile.findUnique({ where: { userId }, select: { currency: true } });
  const payslip = await prisma.payslip.create({
    data: {
      userId,
      month,
      gross,
      deductions,
      net: gross - deductions,
      currency: profile?.currency ?? "INR",
      notes: (body.notes as string) ?? null,
    },
  });
  await logActivity({ userId: req.currentUser!.id, action: "ADD_PAYSLIP", entityType: "USER", entityId: userId, metadata: { month } });
  return sendSuccess(res, payslip, "Payslip added", 201);
}

/* ── Announcements (any auth user reads; ADMIN+ writes) ──────── */

export async function listAnnouncements(req: Request, res: Response) {
  const profile = await prisma.employeeProfile.findUnique({
    where: { userId: req.currentUser!.id },
    select: { departmentId: true },
  });
  const announcements = await prisma.announcement.findMany({
    where: {
      OR: [
        { audience: "ALL" },
        ...(profile?.departmentId ? [{ audience: "DEPARTMENT" as const, departmentId: profile.departmentId }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      department: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });
  return sendSuccess(res, announcements);
}

export async function createAnnouncement(req: Request, res: Response) {
  const body = req.body as Record<string, unknown>;
  const audience = (body.audience as "ALL" | "DEPARTMENT") ?? "ALL";
  if (audience === "DEPARTMENT" && !body.departmentId) {
    throw new AppError(400, "DEPT_REQUIRED", "Select a department for a department-only announcement");
  }
  const announcement = await prisma.announcement.create({
    data: {
      title: String(body.title),
      body: String(body.body),
      audience,
      departmentId: audience === "DEPARTMENT" ? (body.departmentId as string) : null,
      createdById: req.currentUser!.id,
    },
  });
  await logActivity({ userId: req.currentUser!.id, action: "CREATE_ANNOUNCEMENT", entityType: "USER", entityId: announcement.id });
  return sendSuccess(res, announcement, "Announcement posted", 201);
}

export async function deleteAnnouncement(req: Request, res: Response) {
  const id = paramId(req);
  await prisma.announcement.delete({ where: { id } });
  return sendSuccess(res, { id }, "Announcement deleted");
}
