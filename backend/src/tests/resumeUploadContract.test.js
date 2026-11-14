'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const upload = require('../middleware/uploadmiddleware');
const { textPDF } = require('./fixtures/b2Fixture');
const uploadRoot = path.resolve(__dirname, '../../uploads');

for (const driver of ['filesystem', 'b2']) {
  test(`multipart field file is accepted by the ${driver} resume upload parser`, async (t) => {
    const previousDriver = process.env.STORAGE_DRIVER;
    process.env.STORAGE_DRIVER = driver;
    const taskFiles = [];
    const app = express();
    app.post(
      '/upload',
      (req, res, next) => {
        req.user = { _id: 'resume-contract-fixture' };
        next();
      },
      upload.resumePdf,
      (req, res) => {
        if (req.file.path) taskFiles.push(req.file.path);
        res.json({ field: req.file.fieldname, name: req.file.originalname, size: req.file.size });
      }
    );
    const server = await new Promise((resolve) => {
      const handle = app.listen(0, '127.0.0.1', () => resolve(handle));
    });
    t.after(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      if (previousDriver === undefined) delete process.env.STORAGE_DRIVER;
      else process.env.STORAGE_DRIVER = previousDriver;
      // Only files returned by this test's own successful middleware invocation are owned.
      for (const file of taskFiles) {
        assert.equal(path.dirname(path.resolve(file)), uploadRoot);
        assert.ok(path.basename(file).startsWith('resume-contract-fixture-'));
        assert.equal((await fs.lstat(file)).isFile(), true);
        await fs.unlink(file);
      }
    });
    const pdf = textPDF(
      'Synthetic developer resume. Skills Python SQL TypeScript. Experience building tested applications.'
    );
    const post = async (field) => {
      const body = new FormData();
      body.append(field, new Blob([pdf], { type: 'application/pdf' }), 'synthetic.pdf');
      return fetch(`http://127.0.0.1:${server.address().port}/upload`, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(10000)
      });
    };
    const accepted = await post('file');
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), {
      field: 'file',
      name: 'synthetic.pdf',
      size: pdf.length
    });
    const rejected = await post('resume');
    assert.equal(rejected.status, 400);
    assert.deepEqual(await rejected.json(), { message: 'Invalid resume upload' });
  });
}
