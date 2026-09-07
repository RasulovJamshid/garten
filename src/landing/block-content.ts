import { z } from 'zod';
import { AppErrors } from '../common/exceptions/app.exception';

/**
 * The landing page's section catalog — the shape of every block type, in
 * code, the same way `permission-catalog.ts` owns the permission list.
 *
 * Why not columns: a marketing page changes shape constantly ("add Our
 * Teachers", "hide pricing", "move the gallery up"). Typed columns would
 * mean a migration per change; a free-form JSON bag would mean the admin
 * UI and the public site each guessing at the shape. These schemas keep
 * the column stable (`landing_block.content` is jsonb) while every write
 * is still validated at the edge — and the admin UI can render a form per
 * block type straight from `LANDING_BLOCK_TYPES`.
 *
 * Adding a section type = one entry here. No migration, no DTO churn.
 */

/**
 * Locales landing copy is authored in. uz/ru match the rest of the app;
 * en exists for the public site only — staff-facing text stays uz/ru.
 */
export const LANDING_LOCALES = ['uz', 'ru', 'en'] as const;
export type LandingLocale = (typeof LANDING_LOCALES)[number];

/**
 * A translatable string. Every locale is optional so an editor can publish
 * uz+ru today and fill in en later; the public endpoint falls back rather
 * than rendering a hole (see `pickLocale`).
 */
const i18nText = z
  .object({
    uz: z.string().max(5000).optional(),
    ru: z.string().max(5000).optional(),
    en: z.string().max(5000).optional(),
  })
  .strict();

const optionalI18n = i18nText.optional();
const fileId = z.string().uuid();

export type I18nText = z.infer<typeof i18nText>;

const heroSchema = z
  .object({
    title: i18nText,
    subtitle: optionalI18n,
    imageFileId: fileId.optional(),
    ctaLabel: optionalI18n,
    ctaHref: z.string().max(500).optional(),
  })
  .strict();

const richTextSchema = z
  .object({
    title: optionalI18n,
    body: i18nText,
    imageFileId: fileId.optional(),
  })
  .strict();

const featuresSchema = z
  .object({
    title: optionalI18n,
    items: z
      .array(
        z
          .object({
            title: i18nText,
            description: optionalI18n,
            icon: z.string().max(64).optional(),
            imageFileId: fileId.optional(),
          })
          .strict(),
      )
      .max(24),
  })
  .strict();

const gallerySchema = z
  .object({
    title: optionalI18n,
    images: z.array(z.object({ fileId, caption: optionalI18n }).strict()).max(60),
  })
  .strict();

const teachersSchema = z
  .object({
    title: optionalI18n,
    people: z
      .array(
        z
          .object({
            name: z.string().max(200),
            role: optionalI18n,
            bio: optionalI18n,
            photoFileId: fileId.optional(),
          })
          .strict(),
      )
      .max(60),
  })
  .strict();

const pricingSchema = z
  .object({
    title: optionalI18n,
    note: optionalI18n,
    plans: z
      .array(
        z
          .object({
            name: i18nText,
            // Free text, NOT a money amount: this is marketing copy
            // ("from 1 500 000 UZS / month"), never something billing
            // reads. Real tariffs live in the `tariff` table, as tiyin.
            price: i18nText,
            description: optionalI18n,
            highlighted: z.boolean().optional(),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();

const testimonialsSchema = z
  .object({
    title: optionalI18n,
    items: z
      .array(
        z
          .object({
            quote: i18nText,
            author: z.string().max(200),
            role: optionalI18n,
            photoFileId: fileId.optional(),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();

const faqSchema = z
  .object({
    title: optionalI18n,
    items: z.array(z.object({ question: i18nText, answer: i18nText }).strict()).max(50),
  })
  .strict();

const contactsSchema = z
  .object({
    title: optionalI18n,
    address: optionalI18n,
    phones: z.array(z.string().max(40)).max(10).optional(),
    email: z.string().email().max(200).optional(),
    workingHours: optionalI18n,
    mapEmbedUrl: z.string().url().max(1000).optional(),
    social: z
      .array(z.object({ platform: z.string().max(40), url: z.string().url().max(500) }).strict())
      .max(12)
      .optional(),
  })
  .strict();

const ctaSchema = z
  .object({
    title: i18nText,
    subtitle: optionalI18n,
    buttonLabel: i18nText,
    buttonHref: z.string().max(500),
  })
  .strict();

const statsSchema = z
  .object({
    title: optionalI18n,
    items: z.array(z.object({ value: z.string().max(40), label: i18nText }).strict()).max(12),
  })
  .strict();

export const BLOCK_SCHEMAS = {
  hero: heroSchema,
  about: richTextSchema,
  features: featuresSchema,
  gallery: gallerySchema,
  teachers: teachersSchema,
  pricing: pricingSchema,
  testimonials: testimonialsSchema,
  faq: faqSchema,
  contacts: contactsSchema,
  cta: ctaSchema,
  stats: statsSchema,
} as const;

export type LandingBlockType = keyof typeof BLOCK_SCHEMAS;
export const LANDING_BLOCK_TYPES = Object.keys(BLOCK_SCHEMAS) as LandingBlockType[];

export function isLandingBlockType(value: string): value is LandingBlockType {
  return Object.prototype.hasOwnProperty.call(BLOCK_SCHEMAS, value);
}

/**
 * Validates `content` against its declared type and returns the parsed
 * value. Throws the app's own VALIDATION_FAILED envelope (422) rather than
 * a raw ZodError, so a landing write fails exactly like every other
 * endpoint (ops-reference §2).
 */
export function parseBlockContent(type: string, content: unknown): Record<string, unknown> {
  if (!isLandingBlockType(type)) {
    throw AppErrors.validationFailed(
      `Unknown block type '${type}'. Known types: ${LANDING_BLOCK_TYPES.join(', ')}`,
    );
  }
  const result = BLOCK_SCHEMAS[type].safeParse(content);
  if (!result.success) {
    throw AppErrors.validationFailed(
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data as Record<string, unknown>;
}

/**
 * Every file id a block references, wherever it sits in that block's shape.
 * Collected by key name rather than with a per-type extractor so a new
 * block type carrying an `imageFileId`/`fileId`/`photoFileId` is covered
 * the moment it's added — this set is the allow-list the public media
 * route serves from, so missing one means a broken image on the live site.
 */
const FILE_ID_KEYS = new Set(['fileId', 'imageFileId', 'photoFileId', 'ogImageFileId']);

export function collectFileIds(value: unknown, acc = new Set<string>()): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectFileIds(item, acc);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (FILE_ID_KEYS.has(key) && typeof child === 'string') acc.add(child);
      else collectFileIds(child, acc);
    }
  }
  return [...acc];
}

/**
 * Collapses a locale-keyed string for the public endpoint. Falls back
 * through the requested locale → ru → uz → en, because a visitor seeing a
 * section in the wrong language beats seeing it empty.
 */
export function pickLocale(value: I18nText, locale: LandingLocale): string | undefined {
  for (const candidate of [locale, 'ru', 'uz', 'en'] as LandingLocale[]) {
    const text = value[candidate];
    if (typeof text === 'string' && text.length > 0) return text;
  }
  return undefined;
}

/**
 * Recursively flattens every i18n object inside `content` to the visitor's
 * locale. An object counts as translatable only when every one of its keys
 * is a locale code — the exact shape `i18nText` produces, and nothing else.
 */
export function localizeContent(value: unknown, locale: LandingLocale): unknown {
  if (Array.isArray(value)) return value.map((item) => localizeContent(item, locale));
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const isI18n =
      entries.length > 0 &&
      entries.every(
        ([key, val]) =>
          (LANDING_LOCALES as readonly string[]).includes(key) &&
          (typeof val === 'string' || val === undefined),
      );
    if (isI18n) return pickLocale(value as I18nText, locale) ?? null;
    return Object.fromEntries(entries.map(([key, val]) => [key, localizeContent(val, locale)]));
  }
  return value;
}
