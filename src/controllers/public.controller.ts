import type { Request, Response } from "express";
import { prisma } from "../config/prisma.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { notifyAdmins } from "../services/notification.service.js";

export async function submitInquiry(req: Request, res: Response) {
  const inquiry = await prisma.inquiry.create({ data: req.body });

  await notifyAdmins(
    "New inquiry",
    `${inquiry.name} (${inquiry.email}) submitted an inquiry.`,
    "LEAD",
  );

  return sendSuccess(res, { id: inquiry.id }, "Inquiry submitted successfully. We will contact you soon.", 201);
}

export async function submitQuoteRequest(req: Request, res: Response) {
  // If companyName is provided in the public form, try linking to existing company
  const companyName = req.body.companyName;
  let companyId: string | undefined;

  if (companyName) {
    const existing = await prisma.company.findFirst({
      where: { companyName: { equals: companyName, mode: "insensitive" } },
      select: { id: true },
    });
    companyId = existing?.id;
  }

  // Remove companyName from data since it's not in the QuoteRequest model
  const { companyName: _cn, ...quoteData } = req.body;

  const quote = await prisma.quoteRequest.create({
    data: { ...quoteData, ...(companyId && { companyId }) },
  });

  await notifyAdmins(
    "New quote request",
    `${quote.contactPerson} (${quote.email}) requested a LIMEX quote.`,
    "QUOTE",
  );

  return sendSuccess(res, { id: quote.id }, "Quote request submitted. Our team will review it.", 201);
}

export async function submitSampleRequest(req: Request, res: Response) {
  const companyName = req.body.companyName;
  let companyId: string | undefined;

  if (companyName) {
    const existing = await prisma.company.findFirst({
      where: { companyName: { equals: companyName, mode: "insensitive" } },
      select: { id: true },
    });
    companyId = existing?.id;
  }

  const { companyName: _cn, ...sampleData } = req.body;

  const sample = await prisma.sampleRequest.create({
    data: { ...sampleData, ...(companyId && { companyId }) },
  });

  await notifyAdmins(
    "New sample request",
    `${sample.contactPerson} (${sample.email}) requested a material sample.`,
    "SAMPLE",
  );

  return sendSuccess(res, { id: sample.id }, "Sample request submitted. We will follow up shortly.", 201);
}

export async function submitCalculatorSubmission(req: Request, res: Response) {
  const submission = await prisma.calculatorSubmission.create({ data: req.body });

  if (req.body.email) {
    await notifyAdmins(
      "Calculator submission",
      `${req.body.contactPerson || "A visitor"} used the LIMEX calculator.`,
      "LEAD",
    );
  }

  return sendSuccess(res, { id: submission.id }, "Calculator results saved.", 201);
}

export async function submitChat(req: Request, res: Response) {
  const { messages } = req.body;
  const lastUserMessage = messages[messages.length - 1]?.content.toLowerCase() || "";

  // Very simple fallback bot logic
  let reply = "Thanks for your interest in LIMEX. Our AI assistant is currently being upgraded. Please use the contact forms or request a sample to get in touch with our team directly!";
  
  if (lastUserMessage.includes("what is limex") || lastUserMessage.includes("what is it")) {
    reply = "LIMEX is an innovative material made primarily from limestone (calcium carbonate) and a small amount of polymeric resin. It serves as a sustainable alternative to traditional plastics and paper, significantly reducing CO2 emissions and water usage.";
  } else if (lastUserMessage.includes("replace") || lastUserMessage.includes("packaging")) {
    reply = "Yes! LIMEX can replace various plastic applications including packaging, bags, containers, and sheets. It can be processed using existing plastic molding machinery (injection molding, extrusion, thermoforming).";
  } else if (lastUserMessage.includes("trial") || lastUserMessage.includes("start")) {
    reply = "To start a trial, please use the 'Request a Sample' form on our website or contact us directly. We will guide you through the process, recommend the right grade of LIMEX, and assist with trial runs on your existing machinery.";
  } else if (lastUserMessage.includes("price") || lastUserMessage.includes("cost")) {
    reply = "LIMEX pricing depends on the specific grade and volume required. Because limestone is abundant and inexpensive, LIMEX is often cost-competitive with traditional plastics, especially when factoring in sustainability goals. Please request a quote for exact pricing.";
  }

  return res.json({ success: true, data: { reply } });
}
