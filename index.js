
var logger = require('./lib/logger');

var envEmailAddr   = '<?([^>,]*)>?';
//var postfixQid     = '[0-9A-F]{10,11}';     // default queue ids
var postfixQid     = '[0-9A-F]+';     // default queue ids
var postfixQidLong = '[0-9A-Za-z]{14,16}';  // optional 'long' ids
var postfixNoQid = 'NOQUEUE';
var postfixQidAny  = postfixQidLong + '|' + postfixQid + '|' + postfixNoQid;

var regex = {
  syslog: /^([A-Za-z]{3} [0-9 ]{2} [\d:]{8}) ([^\s]+) ([^[]+)\[([\d]+)\]: (.*)$/,
  'submission/smtpd': new RegExp(
    '^(?:(' + postfixQidAny + '): )?' +
    '(client)=([^,]+), ' +
    '(sasl_method)=([^,]+), ' +
    '(sasl_username)=(.*)$'
  ),
  smtp: new RegExp(
    '^(?:(' + postfixQidAny + '): )?' +
    '(to)=' + envEmailAddr + ', ' +
    '(?:(orig_to)=' + envEmailAddr + ', )?' +
    '(relay)=([^,]+), ' +
    '(?:(conn_use)=([0-9]+), )?' +
    '(delay)=([^,]+), ' +
    '(delays)=([^,]+), ' +
    '(dsn)=([^,]+), ' +
    '(status)=(.*)$'
  ),
  'smtp-client': /^(\S+): client=(\S+)\[(\S+?)\]/,

  'smtp-defer': new RegExp(
    '^(?:(' + postfixQidAny + '): )?' +
    '(?:host) ([^ ]+) ' +
    '(?:said|refused to talk to me): ' +
    '(4[0-9]{2} .*)$'
    // '(?: \\(in reply to (?:end of )?([A-Z ]+) command\\))*'
  ),
  'smtp-timeout': new RegExp(
    '^(?:(' + postfixQidAny + '): )?' +
    'conversation with ([^ ]+) ' +
    'timed out ' + '(.*)$'
  ),
  'smtp-reject': new RegExp(
    '^(?:(' + postfixQidAny + '): )?' +
    'host ([^ ]+) ' +
    '(?:said|refused to talk to me): (5[0-9]{2}.*)$'
  ),
  'smtp-relay-denied': /^(\S+): (\w+): RCPT from (.*?)\[(\d+\.\d+\.\d+\.\d+)\]: (\d+) (\S+) <(.*?)>: Relay access denied; from=<(.*?)> to=<(.*?) proto=(\S+) helo=<(.*?)>/,
  'smtp-conn-err': /^connect to ([^ ]+): (.*)$/,
  'smtp-debug': new RegExp(
    '(?:(' + postfixQidAny + '): )?' +
    '(enabling PIX workarounds|' +
    'Cannot start TLS: handshake failure|' +
    'lost connection with .*|' +
    '^SSL_connect error to .*|' +
    '^warning: .*|' +
    'conversation with |' +
    'host )'
  ),
  'smtp-header': /^(\S+): warning: header (\S+): (.*?) from \S+\[\d+\.\d+\.\d+\.\d+\];/,

  qmgr: new RegExp(
    '^(?:(' + postfixQidAny + '): )?' +
    '(from)=' + envEmailAddr + ', ' +
    '(?:' +
    '(size)=([0-9]+), ' +
    '(nrcpt)=([0-9]+) ' +
    '|' +
    '(status)=(.*)$' +
    ')'
  ),
  'qmgr-retry': new RegExp('^(' + postfixQidAny + '): (removed)'),
  // postfix sometimes truncates the message-id, so don't require ending >
  'message-id': new RegExp(
    '^(?:(' + postfixQidAny + '): )?' +
    '((?:resent-)?message-id)=<(.*?)>?$'
  ),
  pickup: new RegExp(
    '^(?:(' + postfixQidAny + '): )?' +
    '(uid)=([0-9]+) ' +
    '(from)=' + envEmailAddr
  ),
  'pickup-retry': new RegExp(
    '^warning: ' +
    '(' + postfixQidAny + '): ' +
   '(.*)$'
  ),
  error: new RegExp(
    '^(?:(' + postfixQidAny + '): )?' +
    '(to)=' + envEmailAddr + ', ' +
    '(?:(orig_to)=' + envEmailAddr + ', )?' +
    '(relay)=([^,]+), ' +
    '(delay)=([^,]+), ' +
    '(delays)=([^,]+), ' +
    '(dsn)=([^,]+), ' +
    '(status)=(.*)$'
  ),
  'error-retry': new RegExp(
    '^warning: ' +
    '(' + postfixQidAny + '): ' +
    '(.*)$'
  ),
  bounce: new RegExp(
    '^(?:(' + postfixQidAny + '): )?' +
    'sender non-delivery notification: ' +
    '(' + postfixQidAny + '$)'
  ),
  'bounce-fatal': new RegExp(
    '^fatal: ' +
    '(.*?) ' +
    '(' + postfixQidAny + '): ' +
    '(.*)$'
  ),
  local: new RegExp(
    '^(?:(' + postfixQidAny + '): )?' +
    '(to)=' + envEmailAddr + ', ' +
    '(?:(orig_to)=' + envEmailAddr + ', )?' +
    '(relay)=([^,]+), ' +
    '(delay)=([^,]+), ' +
    '(delays)=([^,]+), ' +
    '(dsn)=([^,]+), ' +
    '(status)=(sent .*)$'
  ),
  forwardedAs: new RegExp('forwarded as (' + postfixQidAny + ')\\)'),
  scache:      new RegExp('^statistics: (.*)'),
  postscreen:  new RegExp('^(.*)'),
  postsuper:   new RegExp('^(' + postfixQidAny + '): (.*)$'),
};

exports.asObject = function (line) {

  var match = line.match(regex.syslog);
  if (!match) {
    logger.error('unparsable syslog: ' + line);
    return;
  }

  var syslog = syslogAsObject(match);
  if (!/^postfix/.test(syslog.prog)) return; // not postfix, ignore

  var parsed = exports.asObjectType(syslog.prog, syslog.msg);
  if (!parsed) {
    logger.error('unparsable ' + syslog.prog + ': ' + syslog.msg);
    return;
  }

  ['date','host','prog','pid'].forEach(function (f) {
    if (!syslog[f]) return;
    parsed[f] = syslog[f];
  });

  return parsed;
};

exports.asObjectType = function (type, line) {
  if (!type || !line) {
    logger.error('missing required arg');
    return;
  }
  if ('postfix/' === type.substr(0,8)) type = type.substr(8);

  switch (type) {
    case 'qmgr':
    case 'pickup':
    case 'error':
    case 'submission/smtpd':
      return argAsObject(type, line);
    case 'smtp':
    case 'smtpd':
      return smtpAsObject(line);
    case 'bounce':
      return bounceAsObject(line);
    case 'cleanup':
      return cleanupAsObject(line);
  }

  var match = line.match(regex[type]);
  if (!match) return;

  switch (type) {
    case 'syslog':
      return syslogAsObject(match);
    case 'scache':
      return { statistics: match[1] };
    case 'postscreen':
      return { postscreen: match[1] };
    case 'local':
      return localAsObject(match);
    case 'postsuper':
      return { qid: match[1], msg: match[2] };
  }

  return matchAsObject(match);
};

function syslogAsObject (match) {
  return {
    date: match[1],
    host: match[2],
    prog: match[3],
    pid:  match[4],
    msg:  match[5],
  };
}

function matchAsObject (match) {
  match.shift();
  var obj = {};
  var qid = match.shift();
  if (qid) obj.qid = qid;
  while (match.length) {
    var key = match.shift();
    var val = match.shift();
    if (key === undefined) continue;
    if (val === undefined) continue;
    obj[key] = val;
  }
  return obj;
}

function argAsObject (thing, line) {
  var match = line.match(regex[thing]);
  if (match) return matchAsObject(match);

  match = line.match(regex[thing + '-retry']);
  if (match) return { qid: match[1], msg: match[2] };
}

function cleanupAsObject (line) {
  var match = line.match(regex['smtp-header']);
  if (match) {
    obj = {
      qid: match[1]
    }
    obj[match[2].toLowerCase()] = match[3];
    return obj;
  }

  var match = line.match(regex['message-id']);
  if (match) {
    return {
      qid: match[1],
      message_id: match[3],
    };
  }
  return { msg: match[0] };
}

function smtpAsObject (line) {
  var match = line.match(regex.smtp);
  if (match) return matchAsObject(match);

  match = line.match(regex['smtp-conn-err']);
  if (match) {
    return {
      action: 'delivery',
      mx: match[1],
      err: match[2]
    };
  }

  match = line.match(regex['smtp-client']);
  if (match) {
    return {
      qid: match[1],
      host: match[2],
      ip: match[3]
    };
  }

  match = line.match(regex['smtp-defer']);
  if (match) {
    return {
      action: 'defer',
      qid: match[1],
      host: match[2],
      msg: match[3]
    };
  }
  match = line.match(regex['smtp-relay-denied']);
  //console.log(regex['smtp-relay-denied']);
  //console.log(match);
  if (match) {
    return {
      qid: match[1],
      action: match[2], // reject
      host: match[3],
      ip: match[4],
      ver: match[5],
      smtp_from: match[6],
      from: match[7],
      to: match[8],
      proto: match[9],
      helo: match[10]
    };
  }

  match = line.match(regex['smtp-reject']);
  if (match) {
    return {
      action: 'reject',
      qid: match[1],
      host: match[2],
      msg: match[3],
    };
  }

  match = line.match(regex['smtp-timeout']);
  if (match) {
    return {
      action: 'defer',
      qid: match[1],
      host: match[2],
      msg: match[3],
    };
  }

  match = line.match(regex['smtp-debug']);
  if (!match) return;
  if (match[1] && match[2]) {
    return {
      qid: match[1],
      msg: match[2],
    };
  }
  return { msg: match[0] };
}

function bounceAsObject (line) {

  var match = line.match(regex.bounce);
  if (match) {
    match.shift();
    var obj = {};
    var qid = match.shift();
    if (qid) obj.qid = qid;
    obj.dsnQid = match.shift();
    return obj;
  }

  match = line.match(regex['bounce-fatal']);
  if (match) {
    return {
      qid: match[2],
      msg: 'fatal: ' + match[1] + ': ' + match[3]
    };
  }
}

function localAsObject(match) {
  var obj = matchAsObject(match);
  var m = obj.status.match(regex.forwardedAs);
  if (m) {
    obj.status = 'forwarded';
    obj.forwardedAs = m[1];
  }
  return obj;
}
