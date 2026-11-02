// _serve.mjs — dependency-free static server for the preview.
//   node _serve.mjs            then open  http://127.0.0.1:8795/index.html
// The page is pure ESM + a static import map, so a plain file server is
// enough; nothing here needs node/express/build tooling.
import http from "http";
import fs from "fs";

const root = "c:/Users/ompta/.cline/s_rice";
const port = 8795;

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

const server = http.createServer( ( req, res ) => {
  let p = String( req.url || "/" ).split( "?" )[0];
  p = decodeURIComponent( p );
  if ( p === "/" || p === "" ) p = "/index.html";
  if ( p.split( "/" ).includes( ".." ) ) {
    res.statusCode = 400;
    res.end( "bad path" );
    return;
  }
  const file = root + p;
  try {
    const body = fs.readFileSync( file );
    const ext = file.slice( file.lastIndexOf( "." ) ).toLowerCase();
    res.setHeader( "Content-Type", types[ ext ] || "application/octet-stream" );
    res.setHeader( "Cache-Control", "no-store" );
    res.end( body );
  } catch ( e ) {
    res.statusCode = 404;
    res.end( "not found: " + p );
  }
} );

server.listen( port, "127.0.0.1" );
console.log( "serving " + root + " at http://127.0.0.1:" + port + "/index.html" );
