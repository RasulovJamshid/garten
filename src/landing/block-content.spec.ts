import { AppException } from '../common/exceptions/app.exception';
import { collectFileIds, localizeContent, parseBlockContent, pickLocale } from './block-content';

describe('parseBlockContent', () => {
  it('accepts a valid block and returns the parsed content', () => {
    const content = parseBlockContent('hero', {
      title: { uz: 'Salom', ru: 'Привет' },
      ctaHref: '/apply',
    });
    expect(content).toEqual({ title: { uz: 'Salom', ru: 'Привет' }, ctaHref: '/apply' });
  });

  it('rejects an unknown block type as VALIDATION_FAILED, not a raw ZodError', () => {
    expect.assertions(2);
    try {
      parseBlockContent('not-a-section', {});
    } catch (err) {
      expect(err).toBeInstanceOf(AppException);
      expect((err as AppException).code).toBe('VALIDATION_FAILED');
    }
  });

  it('rejects content that does not match its declared type', () => {
    // `body` is required on an about block, and title must be i18n-shaped.
    expect(() => parseBlockContent('about', { title: 'plain string' })).toThrow(AppException);
  });

  it('rejects unknown keys rather than storing them unvalidated', () => {
    // .strict() — an editor cannot smuggle arbitrary keys into jsonb, which
    // is what keeps the public payload's shape predictable.
    expect(() =>
      parseBlockContent('cta', {
        title: { ru: 'Запишитесь' },
        buttonLabel: { ru: 'Оставить заявку' },
        buttonHref: '/apply',
        onclick: 'alert(1)',
      }),
    ).toThrow(AppException);
  });

  it('validates nested repeatable items', () => {
    const content = parseBlockContent('faq', {
      items: [{ question: { ru: 'Во сколько открываетесь?' }, answer: { ru: 'В 07:00' } }],
    });
    expect((content.items as unknown[]).length).toBe(1);

    expect(() => parseBlockContent('faq', { items: [{ question: { ru: 'Без ответа' } }] })).toThrow(
      AppException,
    );
  });
});

describe('collectFileIds', () => {
  const a = '11111111-1111-1111-1111-111111111111';
  const b = '22222222-2222-2222-2222-222222222222';

  it('finds ids at any depth, under any of the file-id key names', () => {
    const ids = collectFileIds({
      imageFileId: a,
      people: [{ name: 'X', photoFileId: b }],
    });
    expect(ids.sort()).toEqual([a, b].sort());
  });

  it('de-duplicates repeats', () => {
    expect(collectFileIds({ images: [{ fileId: a }, { fileId: a }] })).toEqual([a]);
  });

  it('ignores non-file string fields', () => {
    // A gallery caption that happens to contain a uuid must not become
    // publicly readable — this list is the public media allow-list.
    expect(collectFileIds({ images: [{ caption: { ru: a } }] })).toEqual([]);
  });
});

describe('pickLocale / localizeContent', () => {
  it('returns the requested locale when present', () => {
    expect(pickLocale({ uz: 'Salom', ru: 'Привет', en: 'Hi' }, 'en')).toBe('Hi');
  });

  it('falls back rather than rendering an empty section', () => {
    expect(pickLocale({ ru: 'Привет' }, 'en')).toBe('Привет');
    expect(pickLocale({ uz: 'Salom' }, 'en')).toBe('Salom');
  });

  it('treats an empty string as missing', () => {
    expect(pickLocale({ en: '', ru: 'Привет' }, 'en')).toBe('Привет');
  });

  it('returns undefined when nothing is translated', () => {
    expect(pickLocale({}, 'ru')).toBeUndefined();
  });

  it('flattens every i18n object in a nested structure', () => {
    const localized = localizeContent(
      {
        title: { ru: 'Наши педагоги', en: 'Our teachers' },
        people: [{ name: 'Aziza', role: { ru: 'Воспитатель', en: 'Teacher' } }],
      },
      'en',
    );
    expect(localized).toEqual({
      title: 'Our teachers',
      people: [{ name: 'Aziza', role: 'Teacher' }],
    });
  });

  it('leaves non-i18n objects structurally intact', () => {
    // `social` entries are plain data, not translations — flattening them
    // would destroy the payload.
    const localized = localizeContent(
      { social: [{ platform: 'telegram', url: 'https://t.me/x' }] },
      'ru',
    );
    expect(localized).toEqual({ social: [{ platform: 'telegram', url: 'https://t.me/x' }] });
  });

  it('does not mistake a plain object whose keys merely include a locale', () => {
    const localized = localizeContent({ ru: 'Привет', platform: 'telegram' }, 'ru');
    expect(localized).toEqual({ ru: 'Привет', platform: 'telegram' });
  });

  it('yields null for an untranslated field so the shape stays stable', () => {
    expect(localizeContent({ subtitle: {} }, 'ru')).toEqual({ subtitle: {} });
    expect(localizeContent({ subtitle: { uz: '' } }, 'ru')).toEqual({ subtitle: null });
  });
});
