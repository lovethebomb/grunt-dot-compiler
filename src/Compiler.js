/**
 * Module dependencies.
 */

var grunt = require('grunt')
  , _     = grunt.util._
  , path  = require('path')
  , fs    = require('fs')
  , doT   = require('dot')

/**
 * Compiler.
 */

var Compiler = function(opt) {
  this.opt = _.defaults(opt || {}, {
    variable  : 'tmpl',
    node      : false,
    namespace : false,
    root      : opt.gruntRoot,
    requirejs : false,
    key       : function(filepath) {
      return path.basename(filepath, path.extname(filepath));
    }
  });
  this.opt.variable = opt.variable.replace('window.', '');
  if(this.opt.root.substr(-1) !== '/') {
    this.opt.root += '/';
  }

  this.loadRegex = /\{\{\#\#\s*(def\.\w+)\s*\:\s*load\(['|"](.*?)['|"]\,?\s*(\{\s*(.*?\s*?)+?\})?\s*\);?\s*\#?\}\}/g;

  _.bindAll(this);
};

/**
 * Get absolute path.
 */

Compiler.prototype.getAbsolutePath = function(filePath, loadPath) {
  var res;
  // Check relative path
  if(/^\./.test(loadPath)) {
    res = path.join(this.opt.gruntRoot, path.dirname(filePath), loadPath);
  }
  else {
    res = path.join(this.opt.root, loadPath);
  }
  return res;
};

/**
 * Load partials.
 */

Compiler.prototype.loadPartial = function(m, filePath, loadPath, obj) {
  var customVars = {}, _this = this, pendingPartialLoads = {};

  var _filePath = this.getAbsolutePath(filePath, loadPath);
  var content = fs.readFileSync(_filePath, 'utf8').replace(/<\!\-\-(.|\n)*\!\-\->/g, '');

  if(this.loadRegex.test(content)) {
    _filePath = _filePath.replace(_this.opt.gruntRoot, '');
    content = content.replace(this.loadRegex, function(m, namespace, loadPath, obj) {
      var content = _this.loadPartial(m, _filePath, loadPath, obj);
      pendingPartialLoads[namespace] = content;
      return '';
    });
  }

  if(typeof obj !== 'undefined') {
    var matches = obj.match(/(\w+)\s*\:(.*)\s*/g);
    for(var i = 0; i < matches.length; i++) {
      var _matches = /(\w+)\s*\:(.*)\s*/g.exec(matches[i])
        , key = _matches[1]
        , value = _matches[2].replace(/'|"|\,|\s*/g, '')
        , regex = new RegExp('\\{\\{\\$\\s*(' + key + ')\\s*\\:?\\s*(.*?)\\s*\\}\\}', 'g');

        content = content.replace(regex, function(m, key, defaultValue) {
          if(typeof value === 'undefined' && typeof defaultValue === 'undefined') {
            return '';
          } else if(typeof val !== 'undefined') {
            return defaultValue;
          } else {
            return value;
          }
        });
    }
  }

  content = this.loadPendingPartials(content, pendingPartialLoads);
  content = this.setDefaultValues(content);

  return content;
};

Compiler.prototype.setDefaultValues = function(content) {
  content = content
    .replace(/\{\{\$\s*\w*?\s*\:\s*(.*?)\s*\}\}/g, function(m, p1) {
      return p1;
    })
    .replace(/\{\{\$(.*?)\}\}/g, function() {
      return '';
    });
  return content;

}

/**
 * Loads pending partials.
 */

Compiler.prototype.loadPendingPartials = function(content, pendingPartialLoads) {
  for(var namespace in pendingPartialLoads) {
    content = content.replace(
      new RegExp('\\{\\{\\#\\s*' + namespace + '\\s*\\}\\}', 'g'),
      function(m) {
        return pendingPartialLoads[namespace];
      });
  }
  return content;
};

/**
 * Get file content.
 */

Compiler.prototype.getFileContent = function(filePath) {
  var _this = this, pendingPartialLoads = {};

  // Log file path
  console.log(filePath);

  // Return file content
  var content = grunt.file.read(filePath)
    .replace(/^(?!.*:\/\/$).*\/\/.*/, '')
    .replace(this.loadRegex, function(m, namespace, loadPath, obj) {
      var content = _this.loadPartial(m, filePath, loadPath, obj);
      pendingPartialLoads[namespace] = content;
      return '';
    })
    .replace(/<\!\-\-(.|\n)*\!\-\->/g, '')
    .replace(/^\s+|\s+$|[\r\n]+/gm, '')
    .replace(/\/\*.*?\*\//gm,'');

  content = this.loadPendingPartials(content, pendingPartialLoads);
  return content;
};

/**
 * Compile templates.
 */

Compiler.prototype.compileTemplates = function(files) {

  var js = '', _this = this, templateSettings = this.opt.templateSettings || undefined,
    define = this.opt.namespace ? this.opt.namespace + '.define' : 'define',
    variable = this.opt.variable;

  // RequireJS
  if(!this.opt.requirejs && !this.opt.node) {
    if(variable.indexOf('.') !== -1) {
      js += variable + ' = (function(){' + grunt.util.linefeed;
    } else {
      js += 'var ' + variable + ' = (function(){' + grunt.util.linefeed;
    }
  }

  if(this.opt.requirejs && !this.opt.node) {
    js += 'if(typeof define !== \'function\') {' + grunt.util.linefeed;
    js += '  define = require(\'amdefine\')(module);' + grunt.util.linefeed;
    js += '}' + grunt.util.linefeed;
  }

  if(this.opt.requirejs) {
    js += define + '(function() {';
  }

  // Defining encodeHTML method for the templates
  js += 'function e() {var r={"&":"&#38;","<":"&#60;",">":"&#62;",\'"\':\'&#34;\',"\'":\'&#39;\',"/":\'&#47;\'}, reg = /&(?!#?\w+;)|<|>|"|\'|\\//g;return function() {return this ? this.replace(reg, function(m) {return r[m] || m;}) : this;};};String.prototype.encodeHTML=e();';

  js += 'var ' + variable + ' = {};';

  files.map(function(filePath) {
    var template = _this.getFileContent(filePath)
      , fn       = doT.template(template, templateSettings)
      , key      = _this.opt.key(filePath);
    js += variable + "['" + key + "']=" + fn + ';';
  });

  if(!this.opt.requirejs && !this.opt.node) {
    js += 'return ' + variable + ';})();';
  } else if(this.opt.requirejs) {
    js += 'return ' + variable + ';});';
  } else if(this.opt.simple && this.opt.node){
    js += '';
  } else if(this.opt.node) {
    js += 'module.exports = ' + variable + ';';
  }

  return js;

};

module.exports = Compiler;
