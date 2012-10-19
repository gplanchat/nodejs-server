
var events = require('events');
var EventEmitter = events.EventEmitter;

var util = require('util');

var cluster = require('cluster');

var optimist = require('optimist');

var http = require('http');
var https = require('https');

//var SocketIo = require('socket.io');
var os = require('os');
//var Redis = require('redis');
var fs = require('fs');
//var Url = require('url');
//var Mime = require('mime');

module.exports = Cli;

function Cli() {
    EventEmitter.call(this);

    this._optimist = null;
    this.args = null;

    this.command = null;

    this.workers = [];
}

util.inherits(Cli, EventEmitter);

Cli.prototype.init = function(processHandle) {
    this._optimist = optimist(processHandle.argv).usage('Usage: $0 [options] -d url\n$0 [command] [arg1, [arg2, [...]]]')
        .demand([1])
        .describe('daemon', 'Start as daemon.')
            .boolean('daemon')
            .default('daemon', false)
            .alias('d', 'daemon')
        .describe('cluster', 'Activate CPU cluster mode (daemon mode only).')
            .boolean('cluster')
            .default('cluster', false)
        .describe('cpu', 'Set the maximum threads to use (daemon mode only, with cluster mode activated).')
            .default('cpu', os.cpus().length)
        .describe('address', 'The IP to listen to.')
            .alias('a', 'address')
        .describe('ipv6', 'Activate IP v6 support.')
            .boolean('ipv6')
            .default('ipv6', false)
            .alias('6', 'ipv6')
        .describe('port', 'The TCP port to listen to.')
            .alias('p', 'port')
        .describe('ssl', 'Force SSL usage.')
            .boolean('ssl')
            .default('ssl', false)
            .alias('S', 'ssl')
        .describe('pem', 'PEM file location (for SSL mode).')
        .describe('cert', 'CERT file location (for SSL mode).')
        .describe('file', 'Set the config file to use.')
            .alias('f', 'file')
        .describe('help', 'Show this listing.')
            .boolean('help')
            .alias('h', 'help')
    ;

    this.args = this._optimist.argv;

    if (this.args.help == true) {
        this._optimist.showHelp(console.error);
        console.error("Available commands are:\n" +
            "\tstart      Start a daemon\n" +
            "\tstop       Stop the daemon\n" +
            "\trestart    Restart the daemon\n");
        return this;
    }

    return this;
};

Cli.prototype.buildDaemonConfiguration = function(args) {
    var config = {};

    if (args.file && fs.existsSync(args.file)) {
        var configData = fs.readFileSync(args.file, 'utf8');
        config = JSON.parse(configData);
        delete configData;
    }

    if (typeof config.ssl != 'object') {
        config.ssl = {};
    }

    if (args.ssl == true) {
        config.ssl.active = true;

        if (typeof args.pem != 'undefined') {
            config.ssl.pem = args.pem;
        }

        if (typeof args.cert != 'undefined') {
            config.ssl.cert = args.cert;
        }
    } else {
        config.ssl.active = false;
    }

    if (typeof config.cluster != 'object') {
        config.cluster = {};
    }

    if (args.cluster == true) {
        config.cluster.active = true;
        if (typeof args.cpu == 'number') {
            config.cluster.cpus = args.cpu;
        } else {
            config.cluster.cpus = -1;
        }
    } else {
        config.cluster.active = false;
    }

    if (typeof config.networking != 'object') {
        config.networking = [];
    }

    if (config.networking.length == 0) {
        config.networking[0] = {};
    }

    if (typeof args.port == 'number') {
        config.networking[0].port = args.port;
    } else if (typeof config.networking[0].port != 'number') {
        if (args.ssl == true) {
            config.networking[0].port = 443;
        } else {
            config.networking[0].port = 80;
        }
    }

    if (args.ssl == true) {
        config.networking[0].handler = 'https';
    } else {
        config.networking[0].handler = 'http';
    }

    if (typeof args.address != 'undefined') {
        config.networking.address = args.address;
    } else if (typeof config.networking[0].address != 'string') {
        if (args.ipv6 == true) {
            config.networking[0].address = '::0';
        } else {
            config.networking[0].address = '0.0.0.0';
        }
    }

    return config;
};

function generateCommand(command, args) {
    return function(pubsub) {
        pubsub.publish('command', JSON.stringify({command:command, params:args}));
    }
}

Cli.prototype.buildCommandFrame = function(args) {
    var command = {};
    switch (args._[0]) {
    case 'start':
    case 'stop':
    case 'restart':
        command.cb = generateCommand(args._[0], args._.slice(1));
        break;
    }

    return command;
};

Cli.prototype.runCommand = function(command) {
    command.call(this);

    return this;
};

Cli.prototype.runDaemon = function(config, worker) {
    if (config.ssl.active == true) {
        if (config.ssl.key == 'undefined') {
            throw "No SSL private key has been specified.";
        }
        if (config.ssl.cert == 'undefined') {
            throw "No SSL certificates has been specified.";
        }
    }

    cluster.setupMaster({
        exec: worker,
        args: [],
        silent: false
    });

    if (!config.cluster.active) {
        console.log('[' + this.name + '] CPU Cluster mode is not active.');
    } else {
        var childrenCount = config.cluster.cpu;
        if (config.cluster.cpu <= 0) {
            childrenCount = os.cpus().length;
        }

        var child = null;
        var serializedConfig = JSON.stringify(config);
        for (; childrenCount > 0; childrenCount--) {
            child = cluster.fork();

            child.send(serializedConfig);
            this.workers.push(child);
        }
    }

    return this;
};

Cli.prototype.run = function(worker, asDaemon) {
    if (asDaemon || this.args.daemon) {
        var config = this.buildDaemonConfiguration(this.args);
        return this.runDaemon(config, worker);
    } else {
        var command = this.buildCommandFrame(this.args);
        return this.runCommand(command);
    }
};

