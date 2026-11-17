/*******************************************************************************
 * Copyright (C) Anko, Inc - All Rights Reserved
 * All information contained herein is, and remains
 * the property of Anko Incorporated
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ******************************************************************************/

var express = require('express');
var router = express.Router();

var path = require('path');
var app_dir = path.dirname(require.main.filename);

router.get('/associate/:platform', function (req, res) {
    console.log("Loading application associate for platform " + req.params.platform);
    res.render(app_dir + '/microwarehouse/app_team_member.html', {
        platform: req.params.platform,
        account: config.account
    });
});

module.exports = router;
