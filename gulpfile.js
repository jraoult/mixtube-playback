'use strict';

var path = require('path'),
  gulp = require('gulp'),
  gutil = require('gulp-util'),
  source = require('vinyl-source-stream'),
  watchify = require('watchify'),
  browserify = require('browserify'),
  browserSync = require('browser-sync'),
  watch = require('gulp-watch'),
  jshint = require('gulp-jshint');

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
    './build/test/unit/playerSpec.bundle.js');

  installWatchify(
    './src/test/unit/sequencerSpec.js',
    './build/test/unit/sequencerSpec.bundle.js');

  installWatchify(
    './src/test/integration/playbackSpec.js',
    './build/test/integration/playbackSpec.bundle.js');

  gulp.src(['src/main/**/*.js', 'src/test/**/*.js'])
    .pipe(watch(['src/main/**/*.js', 'src/test/**/*.js']))
    .pipe(jshint())
    .pipe(jshint.reporter('jshint-stylish'));
});

gulp.task('serve', ['watch'], function() {
  var baseDirs = ['src/test/integration/web', 'build/test/integration'];

  browserSync({
    open: false,
    server: {
      baseDir: baseDirs.concat(['node_modules/jasmine-core'])
    }
  });

  gulp.watch(baseDirs.map(function(baseDir) {
    return baseDir + '/**/*';
  }), browserSync.reload);

});

gulp.task('default', ['serve']);