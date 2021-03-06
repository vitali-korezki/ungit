
var ko = require('knockout');
var inherits = require('util').inherits;
var components = require('ungit-components');
var programEvents = require('ungit-program-events');
var _ = require('lodash');
var filesToDisplayIncrmentBy = 50;
var filesToDisplayLimit = filesToDisplayIncrmentBy;


components.register('staging', function(args) {
  return new StagingViewModel(args.server, args.repoPath);
});

var StagingViewModel = function(server, repoPath) {
  var self = this;
  this.server = server;
  this.repoPath = repoPath;
  this.filesByPath = {};
  this.files = ko.observableArray();
  this.commitMessageTitleCount = ko.observable(0);
  this.commitMessageTitle = ko.observable();
  this.commitMessageTitle.subscribe(function(value) {
    self.commitMessageTitleCount(value.length);
  });
  this.commitMessageBody = ko.observable();
  this.inRebase = ko.observable(false);
  this.inMerge = ko.observable(false);
  this.allStageFlag = ko.observable(false);
  this.HEAD = ko.observable();
  this.commitButtonVisible = ko.computed(function() {
    return !self.inRebase() && !self.inMerge();
  });
  this.nFiles = ko.computed(function() {
    return self.files().length;
  });
  this.nStagedFiles = ko.computed(function() {
    return self.files().filter(function(f) { return f.staged(); }).length;
  });
  this.stats = ko.computed(function() {
    return self.nFiles() + ' files, ' + self.nStagedFiles() + ' to be commited';
  });
  this.amend = ko.observable(false);
  this.canAmend = ko.computed(function() {
    return self.HEAD() && !self.inRebase() && !self.inMerge();
  });
  this.canStashAll = ko.computed(function() {
    return !self.amend();
  });
  this.showNux = ko.computed(function() {
    return self.files().length == 0 && !self.amend() && !self.inRebase();
  });
  this.committingProgressBar = components.create('progressBar', { predictionMemoryKey: 'committing-' + this.repoPath, temporary: true });
  this.rebaseContinueProgressBar = components.create('progressBar', { predictionMemoryKey: 'rebase-continue-' + this.repoPath, temporary: true });
  this.rebaseAbortProgressBar = components.create('progressBar', { predictionMemoryKey: 'rebase-abort-' + this.repoPath, temporary: true });
  this.mergeContinueProgressBar = components.create('progressBar', { predictionMemoryKey: 'merge-continue-' + this.repoPath, temporary: true });
  this.mergeAbortProgressBar = components.create('progressBar', { predictionMemoryKey: 'merge-abort-' + this.repoPath, temporary: true });
  this.stashProgressBar = components.create('progressBar', { predictionMemoryKey: 'stash-' + this.repoPath, temporary: true });
  this.commitValidationError = ko.computed(function() {
    if (!self.amend() && !self.files().some(function(file) { return file.staged(); }))
      return "No files to commit";

    if (self.files().some(function(file) { return file.conflict(); }))
      return "Files in conflict";

    if (!self.commitMessageTitle() && !self.inRebase()) return "Provide a title";
    return "";
  });
  this.toggleSelectAllGlyphClass = ko.computed(function() {
    if (self.allStageFlag()) return 'glyphicon-unchecked';
    else return 'glyphicon-check';
  });

  this.refreshContentThrottled = _.throttle(this.refreshContent.bind(this), 400, { trailing: true });
  this.invalidateFilesDiffsThrottled = _.throttle(this.invalidateFilesDiffs.bind(this), 400, { trailing: true });
  this.refreshContentThrottled();
  this.textDiffTypeIndex = ko.observable(0);
  this.textDiffOptions = [ { name: 'Default Diff', component: 'textdiff' },
                           { name: 'Side-by-Side Diff', component: 'sidebysidediff' } ];
  this.textDiffType = ko.computed(function() {
    return this.textDiffOptions[this.textDiffTypeIndex()];
  }, this);
  if (window.location.search.indexOf('noheader=true') >= 0)
    this.refreshButton = components.create('refreshbutton');
  this.loadAnyway = false;
  this.isDiagOpen = false;
}
StagingViewModel.prototype.updateNode = function(parentElement) {
  ko.renderTemplate('staging', this, {}, parentElement);
}
StagingViewModel.prototype.onProgramEvent = function(event) {
  if (event.event == 'request-app-content-refresh') {
    this.refreshContent();
    this.invalidateFilesDiffs();
  }
  if (event.event == 'working-tree-changed') {
    this.refreshContentThrottled();
    this.invalidateFilesDiffsThrottled();
  }
}
StagingViewModel.prototype.refreshContent = function(callback) {
  var self = this;
  this.server.get('/head', { path: this.repoPath, limit: 1 }, function(err, log) {
    if (err) {
      return err.errorCode == 'must-be-in-working-tree' ||
        err.errorCode == 'no-such-path';
    }
    if (log.length > 0) {
      var array = log[0].message.split('\n');
      self.HEAD({title: array[0], body: array.slice(2).join('\n')});
    }
    else self.HEAD(null);
  });
  this.server.get('/status', { path: this.repoPath, fileLimit: filesToDisplayLimit }, function(err, status) {
    if (err) {
      if (callback) callback(err);
      return err.errorCode == 'must-be-in-working-tree' ||
        err.errorCode == 'no-such-path';
    }

    if (Object.keys(status.files).length > filesToDisplayLimit && !self.loadAnyway && !self.isDiagOpen) {
      self.isDiagOpen = true;
      var diag = components.create('TooManyFilesDialogViewModel', { title: 'Too many unstaged files', details: 'It is recommended to use command line as ungit may be too slow.'});

      diag.closed.add(function() {
        self.isDiagOpen = false;
        if (diag.result()) {
          self.loadAnyway = true;
          self.loadStatus(status, callback);
        } else {
          window.location.href = '/#/';
        }
      })

      programEvents.dispatch({ event: 'request-show-dialog', dialog: diag });
    } else {
      self.loadStatus(status, callback);
    }
    self.inRebase(!!status.inRebase);
    self.inMerge(!!status.inMerge);
    if (status.inMerge) {
      var lines = status.commitMessage.split('\n');
      self.commitMessageTitle(lines[0]);
      self.commitMessageBody(lines.slice(1).join('\n'));
    }
    if (callback) callback();
  });
}
StagingViewModel.prototype.loadStatus = function(status, callback) {
  this.setFiles(status.files);
  this.inRebase(!!status.inRebase);
  this.inMerge(!!status.inMerge);
  if (status.inMerge) {
    var lines = status.commitMessage.split('\n');
    this.commitMessageTitle(lines[0]);
    this.commitMessageBody(lines.slice(1).join('\n'));
  }
  if (callback) callback();
}
StagingViewModel.prototype.setFiles = function(files) {
  var self = this;
  var newFiles = [];
  for(var file in files) {
    var fileViewModel = this.filesByPath[file];
    if (!fileViewModel) {
      this.filesByPath[file] = fileViewModel = new FileViewModel(self, file, files[file].type, self.textDiffType);
    }
    fileViewModel.setState(files[file]);
    fileViewModel.invalidateDiff();
    newFiles.push(fileViewModel);
  }
  this.files(newFiles);
  programEvents.dispatch({ event: 'init-tooltip' });
}
StagingViewModel.prototype.toggleAmend = function() {
  if (!this.amend() && !this.commitMessageTitle()) {
    this.commitMessageTitle(this.HEAD().title);
    this.commitMessageBody(this.HEAD().body);
  }
  else if(this.amend()) {
    var isPrevDefaultMsg =
      this.commitMessageTitle() == this.HEAD().title &&
      this.commitMessageBody() == this.HEAD().body;
    if (isPrevDefaultMsg) {
      this.commitMessageTitle('');
      this.commitMessageBody('');
    }
  }
  this.amend(!this.amend());
}
StagingViewModel.prototype.commit = function() {
  var self = this;
  this.committingProgressBar.start();
  var files = this.files().filter(function(file) {
    return file.staged();
  }).map(function(file) {
    return file.name();
  });
  var commitMessage = this.commitMessageTitle();
  if (this.commitMessageBody()) commitMessage += '\n\n' + this.commitMessageBody();
  this.server.post('/commit', { path: this.repoPath, message: commitMessage, files: files, amend: this.amend() }, function(err, res) {
    self.committingProgressBar.stop();
    if (err) {
      return;
    }
    self.commitMessageTitle('');
    self.commitMessageBody('');
    self.amend(false);
    self.files([]);
  });
}
StagingViewModel.prototype.rebaseContinue = function() {
  var self = this;
  this.rebaseContinueProgressBar.start();
  this.server.post('/rebase/continue', { path: this.repoPath }, function(err, res) {
    self.rebaseContinueProgressBar.stop();
  });
}
StagingViewModel.prototype.rebaseAbort = function() {
  var self = this;
  this.rebaseAbortProgressBar.start();
  this.server.post('/rebase/abort', { path: this.repoPath }, function(err, res) {
    self.rebaseAbortProgressBar.stop();
  });
}
StagingViewModel.prototype.mergeContinue = function() {
  var self = this;
  this.mergeContinueProgressBar.start();
  var commitMessage = this.commitMessageTitle();
  if (this.commitMessageBody()) commitMessage += '\n\n' + this.commitMessageBody();
  this.server.post('/merge/continue', { path: this.repoPath, message: commitMessage }, function(err, res) {
    self.mergeContinueProgressBar.stop();
  });
}
StagingViewModel.prototype.mergeAbort = function() {
  var self = this;
  this.mergeAbortProgressBar.start();
  this.server.post('/merge/abort', { path: this.repoPath }, function(err, res) {
    self.mergeAbortProgressBar.stop();
  });
}
StagingViewModel.prototype.invalidateFilesDiffs = function() {
  this.files().forEach(function(file) {
    file.invalidateDiff(false);
  });
}
StagingViewModel.prototype.discardAllChanges = function() {
  var self = this;
  var diag = components.create('yesnodialog', { title: 'Are you sure you want to discard all changes?', details: 'This operation cannot be undone.'});
  diag.closed.add(function() {
    if (diag.result()) self.server.post('/discardchanges', { path: self.repoPath, all: true });
  });
  programEvents.dispatch({ event: 'request-show-dialog', dialog: diag });
}
StagingViewModel.prototype.stashAll = function() {
  var self = this;
  this.stashProgressBar.start();
  this.server.post('/stashes', { path: this.repoPath, message: this.commitMessageTitle() }, function(err, res) {
    self.stashProgressBar.stop();
  });
}
StagingViewModel.prototype.toggleAllStages = function() {
  var self = this;
  for (var n in self.files()){
    self.files()[n].staged(self.allStageFlag());
  }

  self.allStageFlag(!self.allStageFlag());
}
StagingViewModel.prototype.viewTypeChangeClick = function(index) {
  this.textDiffTypeIndex(index);
}
StagingViewModel.prototype.onEnter = function(d, e){
    if (e.keyCode === 13 && !this.commitValidationError()) {
      this.commit();
    }
    return true;
};
StagingViewModel.prototype.onAltEnter = function(d, e){
    if (e.keyCode === 13 && e.altKey && !this.commitValidationError()) {
      this.commit();
    }
    return true;
};


var FileViewModel = function(staging, name, fileType, textDiffType) {
  var self = this;
  this.staging = staging;
  this.server = staging.server;
  this.staged = ko.observable(true);
  this.name = ko.observable(name);
  this.isNew = ko.observable(false);
  this.removed = ko.observable(false);
  this.conflict = ko.observable(false);
  this.showingDiffs = ko.observable(false);
  this.diffsProgressBar = components.create('progressBar', { predictionMemoryKey: 'diffs-' + this.staging.repoPath, temporary: true });
  this.diffType = ko.computed(function() {
    if (!self.name()) {
      return 'textdiff';
    }

    if (fileType === 'text') {
      return self.isNew() ? 'textdiff' : textDiffType().component ;
    } else {
      return 'imagediff';
    }
  });
  this.diff = ko.observable(self.getSpecificDiff());

  textDiffType.subscribe(function() {
    self.diff(self.getSpecificDiff());
    self.invalidateDiff(true);
  });
}
FileViewModel.prototype.getSpecificDiff = function() {
  return components.create(this.diffType(), {
    filename: this.name(),
    repoPath: this.staging.repoPath,
    server: this.server,
    initialDisplayLineLimit: 50     //Image diff doesn't use this so it doesn't matter.
  });
}
FileViewModel.prototype.setState = function(state) {
  this.isNew(state.isNew);
  this.removed(state.removed);
  this.conflict(state.conflict);
  if (this.diff().isNew) this.diff().isNew(state.isNew);
  if (this.diff().isRemoved) this.diff().isRemoved(state.removed);
}
FileViewModel.prototype.toggleStaged = function() {
  this.staged(!this.staged());
}
FileViewModel.prototype.discardChanges = function() {
  var self = this;
  var diag = components.create('yesnodialog', { title: 'Are you sure you want to discard these changes?', details: 'This operation cannot be undone.'});
  diag.closed.add(function() {
    if (diag.result()) self.server.post('/discardchanges', { path: self.staging.repoPath, file: self.name() });
  });
  programEvents.dispatch({ event: 'request-show-dialog', dialog: diag });
}
FileViewModel.prototype.ignoreFile = function() {
  var self = this;
  this.server.post('/ignorefile', { path: this.staging.repoPath, file: this.name() }, function(err) {
    if (err && err.errorCode == 'file-already-git-ignored') {
      // The file was already in the .gitignore, so force an update of the staging area (to hopefull clear away this file)
      programEvents.dispatch({ event: 'working-tree-changed' });
      return true;
    }
  });
}
FileViewModel.prototype.resolveConflict = function() {
  this.server.post('/resolveconflicts', { path: this.staging.repoPath, files: [this.name()] });
}
FileViewModel.prototype.toggleDiffs = function() {
  var self = this;
  if (this.showingDiffs()) this.showingDiffs(false);
  else {
    this.showingDiffs(true);
    this.invalidateDiff(true);
  }
}
FileViewModel.prototype.invalidateDiff = function(drawProgressBar) {
  var self = this;
  if (this.showingDiffs() && (drawProgressBar || this.type != 'image')) {
    this.diffsProgressBar.start();
    this.diff().invalidateDiff(function() {
      self.diffsProgressBar.stop();
    });
  }
}
