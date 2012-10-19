var server = require('../src/server');

var cli = new server.Cli();
cli.init(process).run('gplanchat.server/worker/default');
