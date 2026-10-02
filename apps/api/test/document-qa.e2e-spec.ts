import {
  createTestApp,
  destroyTenant,
  onboardTenant,
  uniquePhone,
  type OnboardedTenant,
  type TestApp,
} from './utils/test-app';
import { toTsQuery } from '../src/modules/ai/document-qa.service';
import { DocumentTextService } from '../src/modules/portal/document-text.service';

/**
 * Asking a question of the drawings.
 *
 * The model's half is a vendor call and is not tested here — it was checked by hand against a
 * three-sheet structural set, and the questions, answers and page citations are in the commit that
 * added it. What is tested is the two deterministic halves on either side of that call, which is
 * where a bug would actually live:
 *
 *   * **Retrieval.** A question becomes a Postgres text query. Get that wrong and the right page is
 *     never retrieved, so the model answers "not in the documents" about something written down in
 *     black and white — a failure that looks like the feature working.
 *   * **Extraction.** A PDF becomes chunks with page numbers. A citation to the wrong page is worse
 *     than no citation, because somebody opens the drawing, sees something else, and stops
 *     trusting every answer after it.
 *
 * Plus the boundary: who can reach the endpoint at all.
 */
describe('asking the documents', () => {
  describe('turning a question into a search', () => {
    it('keeps the words that carry meaning and drops the rest', () => {
      // "what is the" matches every page in the register and ranks none of them.
      expect(toTsQuery('What is the slab thickness on the third floor?')).toBe(
        'slab | thickness | third | floor',
      );
    });

    it('joins terms with OR, not AND', () => {
      /*
       * The one decision this function exists to make.
       *
       * `websearch_to_tsquery` would require every word, and no single drawing note contains all
       * six content words of a spoken question — so an AND query answers nothing at all. OR plus
       * ranking is what puts the page holding "slab" and "thickness" together at the top.
       */
      const query = toTsQuery('concrete grade for columns');
      expect(query).toContain(' | ');
      expect(query).not.toContain(' & ');
    });

    it('strips the characters Postgres would read as query operators', () => {
      // `&`, `|`, `!` and `:` are operators in tsquery. A question containing one is a syntax
      // error at the database unless it is removed here — an injection into the query language.
      const query = toTsQuery('M25 & M30 grades: beams | slabs!');
      expect(query).toBe('m25 | m30 | grades | beams | slabs');
    });

    it('keeps codes and dimensions, which are the point', () => {
      // "M25", "150mm", "c7" are the literal terms somebody is asking about. A stemmer leaves them
      // alone and a stop list must not eat them.
      const query = toTsQuery('what is the tie spacing on column C7');
      expect(query).toContain('c7');
      expect(query).toContain('tie');
    });

    it('returns null for a question with nothing to search for', () => {
      // Rather than sending `to_tsquery('english', '')`, which warns and matches nothing.
      expect(toTsQuery('what is it')).toBeNull();
      expect(toTsQuery('how much ?')).toBeNull();
    });
  });

  describe('reading a document', () => {
    const text = new DocumentTextService();

    it('finds nothing in a file that is not a PDF', async () => {
      // A photographed plan is an image with no text layer. Zero chunks is the honest answer, and
      // the caller reports it as "this is a scan" rather than retrying forever.
      await expect(text.chunksOf(Buffer.from('not a pdf'), 'image/jpeg')).resolves.toEqual([]);
    });

    it('does not throw on a file that claims to be a PDF and is not', async () => {
      // A document register holds what people were sent, and some of it is corrupt. The worker
      // turns a rejection into "unreadable" — but only if the rejection is a rejection, not a hang.
      await expect(
        text.chunksOf(Buffer.from('%PDF-1.4 and then nonsense'), 'application/pdf'),
      ).rejects.toBeDefined();
    });
  });

  describe('the endpoint', () => {
    let test: TestApp;
    let tenant: OnboardedTenant;

    beforeAll(async () => {
      test = await createTestApp();
      tenant = await onboardTenant(test, { name: 'Drawing Builders', phone: uniquePhone() });
    });

    afterAll(async () => {
      if (tenant) await destroyTenant(test, tenant.tenantId);
      await test.close();
    });

    it('refuses a question from nobody', async () => {
      await test
        .http()
        .post('/v1/documents/ask')
        .send({ question: 'what is the slab thickness' })
        .expect(401);
    });

    it('refuses a question too short to retrieve anything', async () => {
      await test
        .http()
        .post('/v1/documents/ask')
        .set({ Authorization: `Bearer ${tenant.accessToken}` })
        .send({ question: 'hi' })
        .expect(422);
    });

    it('answers nothing, without a model call, when there is nothing to search', async () => {
      /*
       * The empty register.
       *
       * A tenant with no documents must not reach the vendor at all — there is no text to retrieve,
       * so there is nothing to ask about, and spending a call to be told so would be a bill for
       * nothing. This is also why the test needs no API key.
       */
      const response = await test
        .http()
        .post('/v1/documents/ask')
        .set({ Authorization: `Bearer ${tenant.accessToken}` })
        .send({ question: 'what is the slab thickness on the third floor' })
        .expect(200);

      expect(response.body.answered).toBe(false);
      expect(response.body.sources).toEqual([]);
      expect(response.body.caveat).toBe('There are no documents here yet.');
    });
  });
});
