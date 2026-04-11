import { z } from 'zod/v4';

export const eventCreateSchema = z.object({
  name: z.string().min(1).max(200),
  name_en: z.string().max(200).optional(),
  location: z.string().max(300).optional(),
  venue: z.string().max(300).optional(),
  start_date: z.iso.date(),
  end_date: z.iso.date(),
  timezone: z.string().default('Europe/Rome'),
});

export const roomCreateSchema = z.object({
  name: z.string().min(1).max(100),
  name_en: z.string().max(100).optional(),
  floor: z.string().max(50).optional(),
  capacity: z.int().min(0).optional(),
  room_type: z.enum(['main', 'breakout', 'preview', 'poster']).default('main'),
  display_order: z.int().min(0).default(0),
});

export const sessionCreateSchema = z.object({
  title: z.string().min(1).max(300),
  title_en: z.string().max(300).optional(),
  session_type: z.enum(['talk', 'panel', 'workshop', 'break', 'ceremony']).default('talk'),
  scheduled_start: z.iso.datetime(),
  scheduled_end: z.iso.datetime(),
  display_order: z.int().min(0).default(0),
  chair_name: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

export const speakerCreateSchema = z.object({
  full_name: z.string().min(1).max(200),
  email: z.email().optional(),
  company: z.string().max(200).optional(),
  job_title: z.string().max(200).optional(),
  bio: z.string().max(5000).optional(),
  display_order: z.int().min(0).default(0),
});

export type EventCreate = z.infer<typeof eventCreateSchema>;
export type RoomCreate = z.infer<typeof roomCreateSchema>;
export type SessionCreate = z.infer<typeof sessionCreateSchema>;
export type SpeakerCreate = z.infer<typeof speakerCreateSchema>;
