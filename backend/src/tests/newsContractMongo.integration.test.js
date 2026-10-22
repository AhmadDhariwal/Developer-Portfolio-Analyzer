const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { load } = require('./fixtures/newsHubRedisFixture');

test(
  'isolated Mongo read/unread contract persists history atomically',
  { skip: !process.env.NEWS_TEST_MONGODB_URI, timeout: 60000 },
  async (t) => {
    const mongoose = require('mongoose');
    const uri = new URL(process.env.NEWS_TEST_MONGODB_URI);
    assert.equal(uri.protocol, 'mongodb:');
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname));
    const database = `news_contract_test_${randomUUID().replaceAll('-', '')}`;
    const connection = await mongoose
      .createConnection(uri.href, { dbName: database, serverSelectionTimeoutMS: 3000 })
      .asPromise();
    t.after(async () => {
      assert.equal(connection.name, database);
      assert.match(database, /^news_contract_test_/);
      await connection.dropDatabase();
      await connection.close();
    });
    const Saved = connection.model('NewsSavedItem', require('../models/newsSavedItem').schema);
    await Saved.init();
    const controller = load('../controllers/newsController.js', {
      '../models/newsSavedItem': Saved,
      '../services/newsService': {}
    });
    const create = (extra = {}) =>
      Saved.create({
        userId: new mongoose.Types.ObjectId(),
        articleId: randomUUID(),
        title: 'Synthetic reading contract article',
        url: `https://example.com/${randomUUID()}`,
        type: 'read_later',
        articleData: { retained: 'original payload' },
        ...extra
      });
    const invoke = async (item, body, owner = item.userId) => {
      const response = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(value) {
          this.body = value;
          return this;
        }
      };
      await controller.markSavedNewsAsRead({ user: { _id: owner }, params: { id: String(item._id) }, body }, response);
      return response;
    };
    const state = (item) => Saved.findById(item._id).lean();

    await t.test(
      'empty-body read is backward compatible; unread/re-read preserves original fields and timestamps',
      async () => {
        const item = await create();
        const read = await invoke(item, {});
        assert.equal(read.statusCode, 200);
        assert.equal(read.body.message, 'Read later item marked as read.');
        assert.ok(read.body.item.readAt);
        assert.deepEqual(read.body.item.firstReadAt, read.body.item.readAt);
        assert.deepEqual(read.body.item.lastReadAt, read.body.item.readAt);
        assert.equal(read.body.item.readCount, 1);
        const again = await invoke(item, undefined);
        assert.deepEqual(again.body.item, read.body.item);
        const unread = await invoke(item, { read: false });
        assert.equal(unread.body.item.readAt, null);
        assert.deepEqual(unread.body.item.firstReadAt, read.body.item.readAt);
        assert.deepEqual(unread.body.item.lastReadAt, read.body.item.readAt);
        assert.equal(unread.body.item.readCount, 1);
        assert.deepEqual((await invoke(item, { read: false })).body.item, unread.body.item);
        const reread = await invoke(item, { read: true });
        assert.deepEqual(reread.body.item.firstReadAt, read.body.item.readAt);
        assert.deepEqual(reread.body.item.lastReadAt, reread.body.item.readAt);
        assert.equal(reread.body.item.readCount, 2);
        assert.ok(reread.body.item.readAt >= read.body.item.readAt);
        assert.deepEqual((await invoke(item, {})).body.item, reread.body.item);
        const persisted = await state(item);
        assert.equal(String(persisted._id), String(item._id));
        assert.deepEqual(persisted.createdAt, item.createdAt);
        assert.deepEqual(persisted.articleData, item.articleData);
        assert.equal(await Saved.countDocuments({ userId: item.userId }), 1);
      }
    );

    await t.test('legacy stored readAt survives first unread and history is returned through saved GET', async () => {
      const original = new Date('2026-01-01T00:00:00.000Z');
      const _id = new mongoose.Types.ObjectId(),
        userId = new mongoose.Types.ObjectId();
      await Saved.collection.insertOne({
        _id,
        userId,
        articleId: 'legacy',
        title: 'Legacy saved article',
        url: 'https://example.com/legacy',
        type: 'read_later',
        readAt: original,
        createdAt: original
      });
      const legacy = { _id, userId };
      const unread = await invoke(legacy, { read: false });
      assert.equal(unread.body.item.readAt, null);
      assert.deepEqual(unread.body.item.firstReadAt, original);
      assert.deepEqual(unread.body.item.lastReadAt, original);
      assert.equal(unread.body.item.readCount, 1);
      const response = {
        json(value) {
          this.body = value;
        }
      };
      await controller.getSavedNews({ user: { _id: userId }, query: { type: 'read_later' } }, response);
      assert.deepEqual(response.body.items[0].firstReadAt, original);
      assert.deepEqual(response.body.items[0].lastReadAt, original);
      assert.equal(response.body.items[0].readAt, null);
      const reread = await invoke(legacy, {});
      assert.deepEqual(reread.body.item.firstReadAt, original);
      assert.equal(reread.body.item.readCount, 2);
      assert.equal(reread.body.item.id, String(_id));
    });

    await t.test(
      'concurrent identical transitions increment once per completion and survive mixed competing updates',
      async () => {
        const item = await create();
        const first = await Promise.all(Array.from({ length: 12 }, () => invoke(item, { read: true })));
        assert.ok(first.every((result) => result.statusCode === 200 && result.body.item.readCount === 1));
        const original = first[0].body.item.firstReadAt;
        await Promise.all(Array.from({ length: 12 }, () => invoke(item, { read: false })));
        let current = await state(item);
        assert.equal(current.readAt, null);
        assert.equal(current.readCount, 1);
        await Promise.all(Array.from({ length: 12 }, () => invoke(item, {})));
        current = await state(item);
        assert.equal(current.readCount, 2);
        assert.deepEqual(current.firstReadAt, original);
        await Promise.all(Array.from({ length: 8 }, (_, index) => invoke(item, { read: index % 2 === 0 })));
        current = await state(item);
        assert.deepEqual(current.firstReadAt, original);
        assert.ok(current.readCount >= 2 && current.readCount <= 6);
        assert.ok(current.lastReadAt >= original);
        if (current.readAt) assert.deepEqual(current.lastReadAt, current.readAt);
      }
    );

    await t.test(
      'foreign accounts and bookmark records cannot be updated; never-read unread is idempotent',
      async () => {
        const item = await create();
        const foreign = new mongoose.Types.ObjectId();
        assert.equal((await invoke(item, { read: false }, foreign)).statusCode, 404);
        assert.equal((await invoke(item, { read: true }, foreign)).statusCode, 404);
        const unread = await invoke(item, { read: false });
        assert.equal(unread.body.item.readAt, null);
        assert.equal(unread.body.item.firstReadAt, null);
        assert.equal(unread.body.item.lastReadAt, null);
        assert.equal(unread.body.item.readCount, 0);
        assert.deepEqual((await invoke(item, { read: false })).body.item, unread.body.item);
        const bookmark = await create({ type: 'bookmark' });
        assert.equal((await invoke(bookmark, { read: false })).statusCode, 404);
        assert.equal((await invoke(bookmark, {})).statusCode, 404);
        assert.equal((await state(bookmark)).readAt, null);
        t.diagnostic('All writes used a random disposable local database; no application database was loaded.');
      }
    );
  }
);
