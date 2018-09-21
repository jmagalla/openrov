{"changed":false,"filter":false,"title":"cockpit.js","tooltip":"/cockpit/src/cockpit.js","value":"/*\n *\n * Description:\n * This script is the Node.js server for OpenROV.  It creates a server and instantiates an OpenROV\n * and sets the interval to grab frames.  The interval is set with the DELAY variable which is in\n * milliseconds.\n *\n */\nvar CONFIG = require('./lib/config'), fs = require('fs'), express = require('express'), app = express(), server = require('http').createServer(app), io = require('socket.io').listen(server, { log: false, origins: '*:*' }), EventEmitter = require('events').EventEmitter, OpenROVCamera = require(CONFIG.OpenROVCamera), OpenROVController = require(CONFIG.OpenROVController), OpenROVArduinoFirmwareController = require('./lib/OpenROVArduinoFirmwareController'), logger = require('./lib/logger').create(CONFIG), mkdirp = require('mkdirp'), path = require('path');\nvar PluginLoader = require('./lib/PluginLoader');\napp.configure(function () {\n  app.use(express.static(__dirname + '/static/'));\n  app.use(express.json());\n  app.use(express.urlencoded());\n  app.use('/photos', express.directory(CONFIG.preferences.get('photoDirectory')));\n  app.use('/photos', express.static(CONFIG.preferences.get('photoDirectory')));\n  app.set('port', CONFIG.port);\n  app.set('views', __dirname + '/views');\n  app.set('view engine', 'ejs', { pretty: true });\n  app.use(express.favicon(__dirname + '/static/favicon.icon'));\n  app.use(express.logger('dev'));\n  app.use(app.router);\n  app.use('/components', express.static(path.join(__dirname, 'bower_components')));\n  app.use('/plugin_components', express.static('/usr/share/cockpit/bower_components'));\n});\n// Keep track of plugins js and css to load them in the view\nvar scripts = [], styles = [];\n// setup required directories\nmkdirp(CONFIG.preferences.get('photoDirectory'));\nprocess.env.NODE_ENV = true;\nvar globalEventLoop = new EventEmitter();\nvar DELAY = Math.round(1000 / CONFIG.video_frame_rate);\nvar camera = new OpenROVCamera({ delay: DELAY });\nvar controller = new OpenROVController(globalEventLoop);\nvar arduinoUploadController = new OpenROVArduinoFirmwareController(globalEventLoop);\ncontroller.camera = camera;\napp.get('/config.js', function (req, res) {\n  res.type('application/javascript');\n  res.send('var CONFIG = ' + JSON.stringify(CONFIG));\n});\napp.get('/', function (req, res) {\n  res.render('index', {\n    title: 'OpenROV Cockpit',\n    scripts: scripts,\n    styles: styles\n  });\n});\n//socket.io cross domain access\napp.use(function (req, res, next) {\n  res.header('Access-Control-Allow-Origin', '*');\n  res.header('Access-Control-Allow-Headers', 'X-Requested-With');\n  res.header('Access-Control-Allow-Headers', 'Content-Type');\n  res.header('Access-Control-Allow-Methods', 'PUT, GET, POST, DELETE, OPTIONS');\n  next();\n});\nvar connections = 0;\n// SOCKET connection ==============================\nio.sockets.on('connection', function (socket) {\n  connections += 1;\n  if (connections == 1)\n    controller.start();\n  socket.send('initialize');\n  // opens socket with client\n  if (camera.IsCapturing) {\n    socket.emit('videoStarted');\n    console.log('Send videoStarted to client 2');\n  } else {\n    console.log('Trying to restart mjpeg streamer');\n    camera.capture();\n    socket.emit('videoStarted');\n  }\n  socket.emit('settings', CONFIG.preferences.get());\n  var lastping = 0;\n  socket.on('ping', function (id) {\n   if (Math.abs(new Date().getTime() - lastping) > 500) {\n      controller.send('ping(0)');\n      lastping = new Date().getTime();\n      socket.emit('pong', id);\n   }\n    controller.send('ping(0)');\n  });\n  socket.on('tilt_update', function (value) {\n    controller.sendTilt(value);\n  });\n  socket.on('brightness_update', function (value) {\n    controller.sendLight(value);\n  });\n  socket.on('laser_update', function (value) {\n    controller.sendLaser(value);\n  });\n  socket.on('depth_zero', function () {\n    controller.send('dzer()');\n  });\n  socket.on('compass_callibrate', function () {\n    controller.send('ccal()');\n  });\n  socket.on('update_settings', function (value) {\n    for (var property in value)\n      if (value.hasOwnProperty(property))\n        CONFIG.preferences.set(property, value[property]);\n    CONFIG.savePreferences();\n    controller.updateSetting();\n    setTimeout(function () {\n      controller.requestSettings();\n    }, 1000);\n  });\n  socket.on('disconnect', function () {\n    connections -= 1;\n    console.log('disconnect detected');\n    if (connections === 0)\n      controller.stop();\n  });\n  controller.on('status', function (status) {\n    socket.volatile.emit('status', status);\n  });\n  controller.on('navdata', function (navdata) {\n    socket.volatile.emit('navdata', navdata);\n  });\n  controller.on('rovsys', function (data) {\n    socket.emit('rovsys', data);\n  });\n  controller.on('Arduino-settings-reported', function (settings) {\n    socket.emit('settings', settings);\n    console.log('sending arduino settings to web client');\n  });\n  controller.on('settings-updated', function (settings) {\n    socket.emit('settings', settings);\n    console.log('sending settings to web client');\n  });\n  globalEventLoop.on('videoStarted', function () {\n    socket.emit('videoStarted');\n    console.log('sent videoStarted to client');\n  });\n  globalEventLoop.on('videoStopped', function () {\n    socket.emit('videoStopped');\n  });\n  arduinoUploadController.initializeSocket(socket);\n});\ncamera.on('started', function () {\n  console.log('emitted \\'videoStarted\\'');\n  globalEventLoop.emit('videoStarted');\n});\ncamera.capture(function (err) {\n  if (err) {\n    connections -= 1;\n    camera.close();\n    return console.error('couldn\\'t initialize camera. got:', err);\n  }\n});\ncamera.on('error.device', function (err) {\n  console.log('camera emitted an error:', err);\n  globalEventLoop.emit('videoStopped');\n});\nif (process.platform === 'linux') {\n  process.on('SIGTERM', function () {\n    console.error('got SIGTERM, shutting down...');\n    camera.close();\n    process.exit(0);\n  });\n  process.on('SIGINT', function () {\n    console.error('got SIGINT, shutting down...');\n    camera.close();\n    process.exit(0);\n  });\n}\n// Prepare dependency map for plugins\nvar deps = {\n    server: server,\n    app: app,\n    io: io,\n    rov: controller,\n    config: CONFIG,\n    globalEventLoop: globalEventLoop\n  };\n// Load the plugins\nfunction addPluginAssets(result) {\n  scripts = scripts.concat(result.scripts);\n  styles = styles.concat(result.styles);\n  result.assets.forEach(function (asset) {\n    app.use(asset.path, express.static(asset.assets));\n  });\n}\nvar loader = new PluginLoader();\nloader.loadPlugins(path.join(__dirname, 'system-plugins'), '/system-plugin', deps, addPluginAssets);\nloader.loadPlugins(path.join(__dirname, 'plugins'), '/plugin', deps, addPluginAssets);\nmkdirp.sync('/usr/share/cockpit/bower_components');\nloader.loadPlugins('/usr/share/cockpit/bower_components', '/community-plugin', deps, addPluginAssets, function (file) {\n  return file.substring(0, 15) === 'openrov-plugin-';\n});\ncontroller.start();\n// Start the web server\nserver.listen(app.get('port'), function () {\n  console.log('Started listening on port: ' + app.get('port'));\n});\n","undoManager":{"mark":-1,"position":-1,"stack":[]},"ace":{"folds":[],"scrolltop":2081.5,"scrollleft":0,"selection":{"start":{"row":194,"column":0},"end":{"row":194,"column":0},"isBackwards":false},"options":{"guessTabSize":true,"useWrapMode":false,"wrapToView":true},"firstLineState":{"row":172,"state":"no_regex","mode":"ace/mode/javascript"}},"timestamp":1444085660000}