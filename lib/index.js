var Datastore = require('nedb'),
    Promise = require('bluebird');

/**
 * Plugin
 */

module.exports = function (opts) {
    var store = (opts instanceof Datastore);
    var db = store ? opts : new Datastore(opts);
    var usePromises = (opts && opts.usePromises);

    db.loadDatabase();

    return function (Model) {
        if (usePromises) {
            db = Promise.promisifyAll(db);
        }

        Model.db = db;
        Model.index = db.ensureIndex.bind(db);
        Model.removeAll = db.remove.bind(db);
        Model.count = db.count.bind(db);

        Model.once('initialize', function () {
            // create indexes
            Object
                .keys(Model.attrs)
                .forEach(function (attr) {
                    var opts = Model.attrs[attr];
                    if (opts.unique) Model.index({fieldName: attr, unique: true});
                    if (opts.index) Model.index({fieldName: attr})
                })
        });

        Model.save = function (cb) {
            var doc = this.toJSON();
            var self = this;

            if (usePromises) {
                return db.insertAsync(doc).then(function (doc) {
                    // assign pk
                    if (doc) self.attrs._id = doc._id;
                    return doc;
                });
            }

            return db.insert(doc, function (err, doc) {
                // assign pk
                if (doc) self.attrs._id = doc._id;
                cb(err, doc)
            });
        };

        Model.update = function (cb) {
            var changed = this.changed();
            var id = this.primary();
            var doc = {$set: {}};

            // pk can't be changed
            if (changed._id) delete changed._id;

            // don't write if there are no changes
            if (!Object.keys(changed).length) return cb(null, this._attrs);

            Object
                .keys(changed)
                .forEach(function (key) {
                    // TODO atomic ops
                    doc.$set[key] = changed[key]
                });

            if (this.errors.length) return cb(new Error(this.errors[0].message));

            if (usePromises) {
                return db.updateAsync({_id: id}, doc, {}).then(function () {
                    return me._attrs;
                });
            }

            return db.update({_id: id}, doc, {}, function (err) {
                cb(err, this._attrs);
            })
        };

        Model.remove = function (cb) {
            var id = this.primary();

            if (usePromises) {
                return db.removeAsync({_id: id});
            }

            return db.remove({_id: id}, cb);
        };

        Model.query =
            Model.all = function (query, fn) {
                var cur = mixin(db.find(query));

                if (usePromises) {
                    return new Promise(function (resolve, reject) {
                        cur.exec(function (error, data) {
                            if (error) {
                                return reject(error);
                            }

                            return resolve(data);
                        });
                    });
                }

                return (fn) ? cur.exec(fn) : cur;
            };

        Model.find =
            Model.get = function () {
                if (usePromises) {
                    return db.findOneAsync.apply(db, arguments);
                } else {
                    var args = [].slice.call(arguments);
                    var fn = args.pop();
                    var query = args.shift();

                    if (!query) return fn(null, false);

                    if ('string' === typeof query) query = {_id: query};

                    args.unshift(query);
                    args.push(function (err, doc) {
                        if (err) return fn(err, null);
                        if (!doc) return fn(null, false);
                        return fn(null, new Model(doc))
                    });

                    return db.findOne.apply(db, args);
                }
            };

        // mixin Model magic to Cursor
        function mixin(cursor) {
            var exec = cursor._exec;

            cursor._exec = function (callback) {
                exec.call(cursor, function (err, res) {
                    if (res && res.length) res = new Model(res);
                    callback(err, res)
                });
            };

            return cursor
        }
    }
};