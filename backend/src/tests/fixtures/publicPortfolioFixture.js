const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
function load(relative, dependencies = {}) {
  const filename = path.resolve(__dirname, '../../', relative);
  const unit = new Module(filename, module);
  unit.filename = filename;
  unit.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = unit.require.bind(unit);
  unit.require = (name) =>
    Object.hasOwn(dependencies, name) ? dependencies[name] : original(name);
  unit._compile(fs.readFileSync(filename, 'utf8'), filename);
  return unit.exports;
}
const query = (value) => ({
  select() {
    return this;
  },
  sort() {
    return this;
  },
  lean: async () => value
});
function response() {
  return {
    statusCode: 200,
    headers: {},
    set(key, value) {
      this.headers[key] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}
module.exports = { load, query, response };
