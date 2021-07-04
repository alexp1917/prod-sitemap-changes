var cockatiel = require('cockatiel');
var express = require('express');
// for production code, use this:
// require('express-async-errors');
var fetch = require('node-fetch');

// commented because example was incomplete
// var CLIENT = require('../../config/index')
var CLIENT = new Proxy({}, { get(_, prop) { return `https://${prop}`; } });

var sitemap = require('sitemap');
var util = require('util');
var zlib = require('zlib');

var router = express.Router();

require('dotenv').config();

var defaultConfig = {
  maxAge: 3600_000, // 1 hour
};

if (!isNaN(process.env['SITEMAP_CACHE_MAX_AGE'])) {
  defaultConfig.maxAge = parseInt(process.env['SITEMAP_CACHE_MAX_AGE'], 10);
}

function SitemapCache(config = defaultConfig) {
  this.config = config;
  this.lastUpdated = 0;
  this.plainContent = null;
  this.gzippedContent = null;
}

SitemapCache.prototype.doGzip = util.promisify(zlib.gzip);

SitemapCache.prototype.gzipped = async function() {
  await this.maybeRefresh();
  return this.gzippedContent;
};

SitemapCache.prototype.plain = async function() {
  await this.maybeRefresh();
  return this.plainContent;
};

SitemapCache.prototype.fresh = function() {
  var diff = Date.now() - this.lastUpdated;
  return diff < this.config.maxAge;
};

SitemapCache.prototype.maybeRefresh = async function() {
  if (!this.fresh())
    await this.refresh();
};

SitemapCache.prototype.refresh = async function() {
  this.lastUpdated = Date.now();
  try {
    var data = await fetch('https://jsonplaceholder.typicode.com/posts');

    var json = await data.json();

    var smStream = new sitemap.SitemapStream({ hostname: CLIENT[process.env.CLIENT] });
    // var pipeline = smStream.pipe(createGzip());

    // pipe your entries or directly write them.
    for (let index = 0; index < json.length; index++) {
      smStream.write({ url: `/page-1/${json[index].id}`, changefreq: 'daily', priority: 0.3 });
    }
    smStream.end();

    this.plainContent = await sitemap.streamToPromise(smStream);
    this.gzippedContent = await this.doGzip(this.plainContent);
  } catch (e) {
    console.error(e);
    // res.status(500).end();
  }
  
};

var sitemapCache = new SitemapCache();
router.get('/admin/refresh-sitemap', async (req, res) => {
  await sitemapCache.refresh();
  res.status(201).send({ status: 'success', details: 'new sitemap created', });
});

var gzipValue = 'gzip';
function supportsGzip(acceptEncoding) {
  return acceptEncoding && acceptEncoding.toLowerCase().indexOf(gzipValue) > -1;
}

var N = isNaN(process.env['CONCURRENCY'])
  ? 300
  : parseInt(process.env['CONCURRENCY'], 10);

// limit to N concurrent calls
var bulkhead = cockatiel.Policy.bulkhead(N);

// GET events
router.get('/sitemap.xml', async (req, res) => {
  try {
    await bulkhead.execute(async () => {
      // headers
      res.header('Content-Type', 'application/xml');

      // https://mdn.io/Accept-Encoding
      var gzip = supportsGzip(req.get('Accept-Encoding'));
      if (gzip) {
        res.header('Content-Encoding', 'gzip');
        res.end(await sitemapCache.gzipped());
      } else {
        res.end(await sitemapCache.plain());
      }
    });
  } catch (err) {
    if (err instanceof cockatiel.BulkheadRejectedError) {
      res.status(503).send({
        status: 503,
        message: 'Service Not Available',
        path: '/sitemap.xml',
        details: 'too busy',
      });
    } else {
      next(err);
    }
  }
});

module.exports = router;

async function testClass() {
  var assert = (m, c) => { if (!c) throw new Error('Assert failed: ' + m); };

  var fakeRefresh = async function() {
    this.counter++;
    this.lastUpdated = Date.now();
    this.plainContent = Buffer.from('plainContent', 'utf8');
    var gzip = util.promisify(zlib.gzip);
    this.gzippedContent = await gzip(this.plainContent);
  };

  var smc = new SitemapCache();
  smc.refresh = fakeRefresh;
  assert('smc.plain() is ok', await smc.plain());
  assert('smc.gzipped() is ok', await smc.gzipped());

  var cache = new SitemapCache();
  cache.counter = 0;
  cache.refresh = fakeRefresh;
  assert('cache.plain() is ok', await cache.plain());
  assert('cache.gzipped() is ok', await cache.gzipped());
  assert('cache.counter is 1', cache.counter === 1);

  cache.config.maxAge = 10;
  await new Promise(r => setTimeout(r, 20));

  await cache.plain();
  await cache.gzipped();

  assert('cache.counter is 2 after waiting', cache.counter === 2);
  console.log('test is successful!');
}

async function startIt() {
  var app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(router);
  var port = process.env.PORT || '3000';
  await new Promise(r => app.listen(port, r));
  return app;
}

async function main() {
  var app = await startIt();
  console.log('started');
}

var mode = process.env['RUN_MODE'];
if (mode && mode.toLowerCase() == 'test') {
  testClass();
} else if (mode && mode.toLowerCase() == 'run') {
  main();
}
