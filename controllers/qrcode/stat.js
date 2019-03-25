/**
 * Created by Anchel on 2016/11/27.
 */

var async = require('async');
var _ = require('lodash');
var Sequelize = require('sequelize');
var filter = require('../../lib/filter');
var utilLibrary = require('../../lib/utilLibrary');
var ResponseError = require('../../errors/ResponseError');
var wechatApi = require('../../lib/wechat/wechat-api');
var operatelogService = require('../../services/operatelogService');
var t_qrcode_scene = require('../../models/qrcode_scene');
var t_subscribe_user = require('../../models/subscribe_user');

var action_name_arr = ['QR_SCENE', 'QR_LIMIT_SCENE', 'QR_LIMIT_STR_SCENE'];

module.exports = function(router) {
    var fns = filter(['checkperm'], {
        perms: ['qrcode']
    });

    router.get('/', fns, function(req, res) {
        var actionName = req.query.action_name || 'QR_LIMIT_SCENE';
        if (action_name_arr.indexOf(actionName.toUpperCase()) === -1) {
            utilLibrary.outputJsonResult(
                req,
                res,
                new ResponseError('参数错误')
            );
            return;
        }
        actionName = actionName.toLowerCase();
        res.render('qrcode/stat');
    });

    router.get('/detail', fns, function(req, res) {
        var sceneid = req.query.sceneid;
        if (sceneid === null || sceneid === undefined || sceneid === '') {
            utilLibrary.outputJsonResult(
                req,
                res,
                new ResponseError('参数错误')
            );
            return;
        }
        res.render('qrcode/statdetail');
    });

    router.get('/getdata', fns, function(req, res) {
        var actionName = req.query.action_name;
        var count = req.query.count || 20;
        var page = req.query.page || 0;
        count = parseInt(count, 10);
        page = parseInt(page, 10);
        var offset = page * count;
        getlistdata(actionName, offset, count, function(err, d) {
            if (err) {
                utilLibrary.outputJsonResult(
                    req,
                    res,
                    new ResponseError(err.toString())
                );
            } else {
                utilLibrary.outputJsonResult(req, res, d);
            }
        });
    });

    router.get('/detail', fns, function(req, res) {
        var actionName = req.query.action_name;
        var sceneid = req.query.sceneid;
        var count = req.query.count || 20;
        var page = req.query.page || 0;
        count = parseInt(count, 10);
        page = parseInt(page, 10);
        var offset = page * count;
        getdetaildata(sceneid, offset, count, function(err, d) {
            if (err) {
                utilLibrary.outputJsonResult(
                    req,
                    res,
                    new ResponseError(err.toString())
                );
            } else {
                utilLibrary.outputJsonResult(req, res, d);
            }
        });
    });

    router.post('/deldata', fns, function(req, res) {
        var action_name = req.body.action_name;
        var scene_id = req.body.scene_id;

        deldata(action_name, scene_id, function(err, d) {
            if (err) {
                utilLibrary.outputJsonResult(
                    req,
                    res,
                    new ResponseError(err.toString())
                );
            } else {
                utilLibrary.outputJsonResult(req, res, d);
            }
            operatelogService.addLog(req, res, {
                status: err ? 1 : 0
            });
        });
    });

    router.post('/savedata', fns, function(req, res) {
        var scene_id = req.body.scene_id;
        if (scene_id != undefined && !isNaN(scene_id)) {
            scene_id = parseInt(scene_id, 10);
        }
        var action_name = req.body.action_name;
        var name = req.body.name;
        var expire_seconds = req.body.expire_seconds;
        if (expire_seconds && !isNaN(expire_seconds)) {
            expire_seconds = parseInt(expire_seconds, 10);
        }

        if (action_name_arr.indexOf(action_name) == -1) {
            utilLibrary.outputJsonResult(
                req,
                res,
                new ResponseError('参数action_name错误')
            );
            return;
        }

        function genqrcode(callback) {
            if (scene_id) {
                callback(null, {});
            } else {
                t_qrcode_scene
                    .max('scene_id')
                    .then(function(maxid) {
                        if (action_name == 'QR_SCENE') {
                            wechatApi.createTmpQRCode(
                                maxid,
                                expire_seconds,
                                function(err, ret) {
                                    if (err) {
                                        callback(err);
                                    } else {
                                        ret.scene_id = maxid;
                                        callback(null, ret);
                                    }
                                }
                            );
                        } else {
                            wechatApi.createLimitQRCode(maxid, function(
                                err,
                                ret
                            ) {
                                if (err) {
                                    callback(err);
                                } else {
                                    ret.scene_id = maxid;
                                    callback(null, ret);
                                }
                            });
                        }
                    })
                    .catch(function(err) {
                        callback(err);
                    });
            }
        }

        function savedb(callback) {
            var data = {
                scene_id: scene_id,
                action_name: action_name,
                name: name,
                expire_seconds: expire_seconds
            };
            savedata(data, callback);
        }

        function savewxinfo(wxdata, callback) {
            wxdata = wxdata || {};
            var data = {};
            _.extend(data, wxdata);
            savedata(data, callback);
        }

        var fns = [savedb];
        if (!scene_id) {
            fns.push(genqrcode);
            fns.push(savewxinfo);
        }
        async.waterfall(fns, function(err, ret) {
            if (err) {
                utilLibrary.outputJsonResult(
                    req,
                    res,
                    new ResponseError(err.toString())
                );
            } else {
                utilLibrary.outputJsonResult(req, res, ret);
            }
            operatelogService.addLog(req, res, {
                status: err ? 1 : 0
            });
        });
    });

    function savedata(values, callback) {
        t_qrcode_scene
            .upsert(values, {
                scene_id: values.scene_id
            })
            .then(function() {
                callback(null);
            })
            .catch(function(err) {
                callback(err);
            });
    }

    function deldata(actionName, scene_id, callback) {
        t_qrcode_scene
            .destroy({
                where: {
                    action_name: actionName,
                    scene_id: scene_id
                }
            })
            .then(function() {
                callback(null);
            })
            .catch(function(err) {
                callback(err);
            });
    }

    var img_prefix = 'https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=';

    function getlistdata(actionName, offset, limit, callback) {
        t_qrcode_scene
            .findAndCountAll({
                where: {
                    action_name: actionName
                },
                order: [['ctime', 'desc'], ['name', 'desc']],
                offset: offset,
                limit: limit
            })
            .then(function(ret) {
                var rows = ret.rows;
                var count = ret.count;
                var rs = [];
                var rs2 = [];
                var rs3 = [];
                // (async rs3 => {
                //     rs2 = await counter();
                //     rs3 = rs2;
                //     console.log('rs3 = ', rs3);
                // })(console.log('rs3 = ', rs3));

                counter(rows, function(err, rsd) {
                    if (rows) {
                        rows.forEach(function(r) {
                            var ro = {
                                name: r.get('name'),
                                action_name: r.get('action_name'),
                                expire_seconds: r.get('expire_seconds'),
                                scene_id: r.get('scene_id'),
                                scene_str: r.get('scene_str'),
                                ticket: r.get('ticket'),
                                img_url: img_prefix + r.get('ticket'),
                                url: r.get('url'),
                                date_start: r.get('date_start'),
                                date_end: r.get('date_end'),
                                mtime: r.get('mtime'),
                                ctime: r.get('ctime'),
                                subscribe_count: getCountBySceneId(
                                    rsd,
                                    r.get('scene_id'),
                                    1
                                ),
                                unsubscribe_count: getCountBySceneId(
                                    rsd,
                                    r.get('scene_id'),
                                    0
                                )
                            };

                            if (ro.mtime) {
                                ro.mtime = ro.mtime.format(
                                    'yyyy-MM-dd hh:mm:ss'
                                );
                            }
                            if (ro.ctime) {
                                ro.ctime = ro.ctime.format(
                                    'yyyy-MM-dd hh:mm:ss'
                                );
                            }
                            rs.push(ro);
                        });
                    }
                    // hardcode 了了管家 微信公众号
                    rs.push({
                        name: '了了管家',
                        action_name: '',
                        expire_seconds: '',
                        scene_id: 9999,
                        scene_str: '',
                        ticket: '',
                        img_url: 'http://images.llguanjia.com/mp.jpg',
                        url: 'http://images.llguanjia.com/mp.jpg',
                        date_start: '',
                        date_end: '',
                        mtime: '',
                        ctime: '',
                        subscribe_count: getCountBySceneId(
                            rsd,
                            9999,
                            1
                        ),
                        unsubscribe_count: getCountBySceneId(
                            rsd,
                            9999,
                            0
                        )
                    });
                    callback(null, {
                        total_count: count,
                        list: rs
                    });
                });
            })
            .catch(function(err) {
                callback(err);
            });
    }
    function counter(rows, callback) {
        return t_subscribe_user
            .findAll({
                attributes: [
                    'subscribe_scene_id',
                    'subscribe',
                    [Sequelize.fn('COUNT', Sequelize.col('subscribe')), 'count']
                ],
                group: ['subscribe', 'subscribe_scene_id'],
                raw: true
            })
            .then(function(rs) {
                var rsd = [];
                rs.forEach(function(r) {
                    if (r['subscribe_scene_id'] === null) {
                        rsd.push({
                            subscribe_scene_id: 9999,
                            subscribe: r['subscribe'],
                            count: r['count']
                        });
                    } else {
                        rsd.push({
                            subscribe_scene_id: r['subscribe_scene_id'],
                            subscribe: r['subscribe'],
                            count: r['count']
                        });
                    }
                });
                callback(null, rsd, rows);
            })
            .catch(function(err) {
                callback(err);
            });
    }

    function getCountBySceneId(data, scene_id, subscribe) {
        var count = 0;
        if (data) {
            data.forEach(function(r) {
                if (
                    r['subscribe_scene_id'] == scene_id &&
                    r['subscribe'] == subscribe
                ) {
                    count = r['count'];
                }
            });
        }
        return count;
    }

    function getdetaildata(sceneid, offset, limit, callback) {
        console.log('ddddd=============');
        t_subscribe_user
            .findAndCountAll({
                where: {
                    subscribe_scene_id: sceneid
                },
                group: ['mtime'],
                order: [['ctime', 'desc'], ['name', 'desc']],
                offset: offset,
                limit: limit
            })
            .then(function(ret) {
                var rows = ret.rows;
                var count = ret.count;
                var rs = [];
                var rs2 = [];
                var rs3 = [];
                // (async rs3 => {
                //     rs2 = await counter();
                //     rs3 = rs2;
                //     console.log('rs3 = ', rs3);
                // })(console.log('rs3 = ', rs3));

                counter(rows, function(err, rsd) {
                    if (rows) {
                        rows.forEach(function(r) {
                            var ro = {
                                subscribe_scene_id: r.get('subscribe_scene_id'),
                                // action_name: r.get('action_name'),
                                // expire_seconds: r.get('expire_seconds'),
                                // scene_id: r.get('scene_id'),
                                // scene_str: r.get('scene_str'),
                                // ticket: r.get('ticket'),
                                // img_url: img_prefix + r.get('ticket'),
                                // url: r.get('url'),
                                // date_start: r.get('date_start'),
                                // date_end: r.get('date_end'),
                                // mtime: r.get('mtime'),
                                // ctime: r.get('ctime'),
                                subscribe_count: getCountBySceneId(
                                    rsd,
                                    r.get('scene_id'),
                                    1
                                ),
                                unsubscribe_count: getCountBySceneId(
                                    rsd,
                                    r.get('scene_id'),
                                    0
                                )
                            };

                            if (ro.mtime) {
                                ro.mtime = ro.mtime.format(
                                    'yyyy-MM-dd hh:mm:ss'
                                );
                            }
                            if (ro.ctime) {
                                ro.ctime = ro.ctime.format(
                                    'yyyy-MM-dd hh:mm:ss'
                                );
                            }
                            rs.push(ro);
                        });
                    }
                    callback(null, {
                        total_count: count,
                        list: rs
                    });
                });
            })
            .catch(function(err) {
                callback(err);
            });
    }
};
