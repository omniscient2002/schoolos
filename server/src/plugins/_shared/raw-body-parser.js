// Shared raw-bytes JSON capture (payments.upi original, redteam P0-1): real
// gateway HMACs are computed over the WIRE bytes — re-serialized JSON will never
// verify. This JSON parser stores the untouched body on req.rawBody (Buffer) and
// still yields req.body for every route; malformed JSON is a 400, never a 500
// (redteam P1-2).
//
// Wave A: payments.razorpay needs the same capture. Fastify refuses a SECOND
// addContentTypeParser('application/json') (FST_ERR_CTP_ALREADY_PRESENT) and the
// loader mounts plugins alphabetically — so both money rails share this
// install-once helper and the mount order stops mattering. Behavior is byte-
// identical to the parser payments.upi registered inline since cycle-3.
const INSTALLED = Symbol('rawJsonParserInstalled');

export function installRawJsonParser(app) {
  if (app[INSTALLED]) return; // one raw-capturing parser per instance — first rail wins
  app[INSTALLED] = true;
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    req.rawBody = body;
    try {
      done(null, JSON.parse(body.toString('utf8')));
    } catch (err) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });
}
