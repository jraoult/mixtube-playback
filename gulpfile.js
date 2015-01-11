'use strict';

var path = require('path'),
  gulp = require('gulp'),
  gutil = require('gulp-util'),
  source = require('vinyl-source-stream'),
  watchify = require('watchify'),
  browserify = require('browserify');

function installWatchify(src, dest) {
  var bundler = watchify(
    browserify(src,
      {
        cache: {},
        packageCache: {},
        fullPaths: true,
        debug: true
      }));

  bundler.on('update', function() {
    gutil.log('Bundle "' + src + '" updated');
    rebundle();
  });

  function rebundle() {
    return bundler.bundle()
      .on('error', gutil.log.bind(gutil, 'Browserify Error'))
      .pipe(source(path.basename(dest)))
      .pipe(gulp.dest(path.dirname(dest)));
  }

  return rebundle();
}

gulp.task('watch', function() {

  installWatchify(
    './src/test/unit/playerSpec.js',
    './dist/test/unit/playerSpec.bundle.js');

  installWatchify(
    './src/test/unit/sequencerSpec.js',
    './dist/test/unit/sequencerSpec.bundle.js');
});

gulp.task('default', ['watch']);