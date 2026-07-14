import { z } from "zod";
import { bilingualTextSchema, uuidSchema } from "./common";

// Staff pass surface (kitchen_pass): plates on active orders awaiting a plating
// photo, and the capture that binds a pass_photo to a REAL order_item.

export const passQueueItemSchema = z.object({
  orderItemId: uuidSchema,
  dishId: uuidSchema,
  name: bilingualTextSchema,
  quantity: z.number().int(),
  tableLabel: z.string(),
  heroPhotoUrl: z.string().nullable(),
});
export type PassQueueItem = z.infer<typeof passQueueItemSchema>;
export const passQueueSchema = z.array(passQueueItemSchema);

export const captureRequestSchema = z.object({
  orderItemId: uuidSchema,
  candidatePhotoKey: z.string().min(1),
});
export type CaptureRequest = z.infer<typeof captureRequestSchema>;

export const captureResponseSchema = z.object({ evaluationId: uuidSchema });
export type CaptureResponse = z.infer<typeof captureResponseSchema>;
