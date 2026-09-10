import { isDraftDirty } from './landing.service';

const at = (ms: number) => new Date(2026, 8, 4, 12, 0, 0, ms);

describe('isDraftDirty', () => {
  it('is dirty before the page has ever been published', () => {
    expect(isDraftDirty({ publishedAt: null, updatedAt: at(0) }, [])).toBe(true);
  });

  it('is clean immediately after a publish', () => {
    // The regression this exists for: publish() computes `publishedAt`
    // and then writes the page row. Left to Prisma's @updatedAt, the row's
    // updatedAt lands a tick LATER than publishedAt, and the publish reads
    // as an unpublished edit — the Publish button never goes quiet. Both
    // publish() and restore() therefore stamp the same instant.
    const published = at(500);
    expect(
      isDraftDirty({ publishedAt: published, updatedAt: published }, [{ updatedAt: at(100) }]),
    ).toBe(false);
  });

  it('reports a page whose own timestamp trails the publish as dirty', () => {
    // Not a bug in this function — this IS the correct reading, and it is
    // precisely why publish()/restore() must not let @updatedAt stamp its
    // own "now". Pinning this behaviour keeps the call-site fix honest.
    expect(isDraftDirty({ publishedAt: at(500), updatedAt: at(501) }, [])).toBe(true);
  });

  it('is dirty when a block was edited after the last publish', () => {
    expect(
      isDraftDirty({ publishedAt: at(500), updatedAt: at(500) }, [
        { updatedAt: at(100) },
        { updatedAt: at(900) },
      ]),
    ).toBe(true);
  });

  it('is dirty when the page itself changed after the last publish (SEO edit)', () => {
    // updateSeo writes the page row without touching any block.
    expect(isDraftDirty({ publishedAt: at(500), updatedAt: at(900) }, [])).toBe(true);
  });

  it('is clean for a published page with no blocks and no later edits', () => {
    expect(isDraftDirty({ publishedAt: at(500), updatedAt: at(500) }, [])).toBe(false);
  });

  it('ignores blocks edited before the last publish', () => {
    expect(
      isDraftDirty({ publishedAt: at(500), updatedAt: at(500) }, [
        { updatedAt: at(10) },
        { updatedAt: at(499) },
      ]),
    ).toBe(false);
  });
});
