const moment = require("moment-timezone");
const { AWS, axios } = require("../library/xray");
const apiRequest = require("../library/apiRequest");
const authHelper = require("../library/authHelper");
const chalk = require("chalk");
const csvConverter = require("json-2-csv");
const stream = require("stream");
AWS.config.update({region: config.aws_region});
const dynamodb = new AWS.DynamoDB.DocumentClient();
const SES = new AWS.SES();
const logger = require("../library/logger")("microwarehouse-api:mw_api_reports");

const helper = require("../library/helperFn");

exports.reports_get_dashboard = async function(req, res) {
    let LocationID = req.query.LocationID; // Location - any location in the cluster.
    let sql, args, results;
    if (!LocationID) {
        res.status(400).json({"message": "LocationID is required! Please provide valid Warehouse Location ID."});
        return;
    }

    // SQL
    // Total Units - select Quantity from all tasks, exclude backup!
    // Completed Units - select QuantityFilled including backup.
    // Showing results from start of day UTC with: AND tg.DateDue > DATE(base.Today), Remove the DATE() to compare start of Day Local time.
    sql = `
        SELECT
            Type,
            TargetLocation,
            Priority,
            DateDue,
            DateCreated,
            (uTotal - uBackup) AS UnitsTotal,
            (uUnavailable - uBackup) AS UnitsUnavailable,
            (uTotal - uBackup) - (uUnavailable - uBackup) AS UnitsStoreTotal,
            (uCompleted + uUnavailable - uBackup) AS UnitsCompleted,
            (uTotal - uUnavailable - uCompleted) AS UnitsToDo,
            (CASE WHEN uDelivered > 0 THEN uDelivered + uUnavailable - uBackup ELSE 0 END) AS UnitsDelivered,
            TaskGroupIDs
        FROM (
            SELECT
                tg.Type,
                tg.TargetLocation,
                tg.Priority,
                tg.DateDue,
                tg.DateCreated,
                SUM(t.Quantity) AS uTotal,
                SUM(CASE WHEN t.isBackup = 1 THEN t.Quantity Else 0 END) AS uBackup,
                IFNULL(SUM(t.QuantityFilled), 0) AS uCompleted, IFNULL(SUM(t.QuantityDelivered), 0) AS uDelivered,
                IFNULL(SUM(CASE WHEN t.QuantityFilled IS NOT NULL THEN t.Quantity - t.QuantityFilled ELSE 0 END), 0) AS uUnavailable,
                GROUP_CONCAT(DISTINCT tg.ID) AS TaskGroupIDs
            FROM (
                SELECT ID AS Location, CONVERT_TZ(DATE(CONVERT_TZ(NOW(), 'UTC', Timezone)), Timezone, 'UTC') AS Today, Timezone
                FROM location WHERE ID IN (SELECT IFNULL(WarehouseID, ID) FROM location WHERE ID = ?)
            ) AS base
            INNER JOIN task_group tg ON tg.SourceLocation = base.Location AND tg.Type in ('Pick','CrossDock')
            INNER JOIN task t ON t.TaskGroupID = tg.ID
            WHERE tg.DateDue > base.Today OR (tg.DateFulfilled IS NULL AND tg.DateDue > DATE_ADD(base.Today, INTERVAL -30 DAY))
            GROUP BY tg.TargetLocation, tg.Priority, tg.DateDue
            ORDER BY tg.Type, tg.DateDue, tg.TargetLocation
        ) AS a
        ;
        SELECT
            tg.ID, tg.Source, tg.Name
        FROM (
            SELECT ID AS Location, CONVERT_TZ(DATE(CONVERT_TZ(NOW(), 'UTC', Timezone)), Timezone, 'UTC') AS Today, Timezone
            FROM location WHERE ID IN (SELECT IFNULL(WarehouseID, ID) FROM location WHERE ID = ?)
        ) AS base
        INNER JOIN task_group tg ON tg.SourceLocation = base.Location AND tg.Type in ('Pick','CrossDock')
        WHERE tg.DateDue > base.Today OR (tg.DateFulfilled IS NULL AND tg.DateDue > DATE_ADD(base.Today, INTERVAL -30 DAY));`;
    args = [LocationID, LocationID];

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("reports_get_dashboard", {error});
        res.status(500).json({"message": "Error occured while retriving the Dashboard data."});
        return;
    }
    let tgs = results[1];
    let taskgroups = {};
    for (const tg of tgs ) {
        taskgroups[tg.ID] = {
            source: tg.Source,
            name: tg.Name
        };
    }

    res.status(200).json({"data": results[0], "taskgroups": taskgroups});
};

exports.reports_get_inventory_discrepancies = async function(req, res) {
    let LocationID = req.query.LocationID; // Location - any location in the cluster.
    let sql, args, results;
    if (!LocationID) {
        res.status(400).json({"message": "LocationID is required! Please provide valid Location ID."});
        return;
    }

    sql = `
        SELECT
            t.DateCreated,
            t.TargetContainer AS Location,
            u.FirstName,
            u.LastName,
            t.SourceContainer AS ContainerID,
            t.Keycode,
            ia.ActualQty
        FROM task t
        LEFT JOIN inventory_adjustment ia ON ia.TaskID = t.ID AND ia.Keycode = t.Keycode
        INNER JOIN user u ON u.ID = t.ReferenceID
        INNER JOIN location l ON l.ID = t.TargetContainer
        WHERE
            (
                # For the last two weeks, only get unchecked inventory tasks
                (t.DateCreated >= NOW() - INTERVAL 14 DAY AND ia.ActualQty IS NULL)
                OR
                # For the last two days, get inventory tasks that were checked
                (t.DateCreated >= NOW() - INTERVAL 2 DAY AND ia.ActualQty IS NOT NULL)
            )
            AND t.TargetContainer = ? # Current location
            AND t.Type = 'Inventory'      # Must have the Inventory type
            AND t.ReferenceID IS NOT NULL # Must have a Reference ID
            AND t.ReferenceID != 0        # Must not have a Reference ID of zero (System User)
            AND (ia.ActualQty != 0 OR t.DateCompleted IS NULL) # Hide rows where the user was correct
        ORDER BY t.DateCreated DESC`;
    args = [LocationID];

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("reports_get_suspicious_inventory", {error});
        res.status(500).json({"message": "Error occured while retriving suspicious inventory data."});
        return;
    }

    res.status(200).json({"data": results});
};

exports.get_rfid_tagging_report = async function(req, res)  {
    let StartDate = req.query.StartDate;
    let EndDate = req.query.EndDate;
    let LocationID = req.query.LocationID;

    let sql, args, results;

    sql = `SELECT Timezone from location WHERE ID = ?;`;
    args = [LocationID];
    try {
        [results] = await ro_pool.query(sql, args);
    } catch (err) {
        logger.error("get_rfid_tagging_report", {err});
        res.status(500).json({"message": "Error occured while retrieving location timezone."});
        return;
    }
    // Add Filter by Location Id in future
    let timezone = results[0].Timezone;
    let start = moment.tz(StartDate, timezone).utc();
    let end = moment.tz(EndDate, timezone).endOf("day").utc();

    sql = `
        SELECT h.DateCreated, h.UserID, h.Quantity
        from rfid_printing_history h
        WHERE DateCreated > ? AND DateCreated < ? AND UserID is not null
        order by UserID`;
    args = [start.format(), end.format()];

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (err) {
        logger.error("get_rfid_tagging_report", {err});
        res.status(500).json({"message": "Error occured retrieving rfid printing history."});
        return;
    }

    let UserID = null;
    let LocalDate = null;
    let StartShift = null;
    let EndShift = null;
    let TagsPrinted = 0;
    let arr = [];

    for (let result of results) {
        let date = moment.tz(result.DateCreated, timezone).format("YYYY-MM-DD");
        let datetime = result.DateCreated;
        let user = result.UserID;
        let qty = parseInt(result.Quantity);

        if (UserID !== null) {
            if (date !== LocalDate || user !== UserID) {
                arr.push({
                    UserID: UserID,
                    TagsPrinted: TagsPrinted,
                    StartShift: StartShift,
                    EndShift: EndShift,
                    LocalDate: LocalDate
                });
                UserID = user;
                TagsPrinted = qty;
                StartShift = datetime;
                EndShift = datetime;
                LocalDate = date;
            } else {
                TagsPrinted += qty;
                EndShift = datetime;
            }
        } else {
            UserID = user;
            TagsPrinted = qty;
            StartShift = datetime;
            EndShift = datetime;
            LocalDate = date;
        }

    }



    let data = [];
    let currUser = null;
    let currIndex = -1;
    for (const result of arr) {
        const id = result.UserID;
        const qty = +result.TagsPrinted;
        const stime = moment.tz(result.StartShift, timezone);
        const etime = moment.tz(result.EndShift, timezone);
        const date = moment(result.LocalDate).format("YYYY-MM-DD");
        let hourly = etime.diff(stime, "m");
        hourly = hourly/60;
        const rate = qty / hourly;
        if (id !== currUser) {
            data.push({
                data: {
                    UserID: id,
                    Date: id,
                    Quantity: qty,
                    Hours: hourly,
                    Rate: rate
                },
                children: [{
                    data: {
                        UserID: id,
                        Date: date,
                        Quantity: qty,
                        Hours: hourly,
                        Rate: rate
                    }
                }]
            });
            currUser = id;
            currIndex++;
        } else {
            const id = result.UserID;
            const qty = +result.TagsPrinted;
            const stime = moment(result.StartShift);
            const etime = moment(result.EndShift);
            const date = moment(result.LocalDate).format("YYYY-MM-DD");
            let hourly = etime.diff(stime, "m");

            hourly = hourly/60;
            const rate = qty / hourly;
            data[currIndex].children.push({
                data: {
                    UserID: id,
                    Date: date,
                    Quantity: qty,
                    Hours: hourly,
                    Rate: rate
                }
            });
            data[currIndex].data.Quantity += qty;
            data[currIndex].data.Hours += hourly;
            const totalrate = data[currIndex].data.Quantity / data[currIndex].data.Hours;
            data[currIndex].data.Rate = totalrate;
        }
    }



    res.status(200).json({"data": data});

};

exports.reports_get_performance_reports_csv = async function(req, res) {
    let StartDate = req.query.StartDate;
    let EndDate = req.query.EndDate;
    let LocationID = req.query.LocationID;
    let user = authHelper.parseRole(req);
    let sql, results, args;
    let isManager = false;
    let options = {prependHeader: false, emptyFieldValue: "", keys: ["Task", "UserID", "Date", "Minutes", "Quantity", "HourlyRate"]}; // Options for .csv file
    let fileData = `Task, UserID, Date, Minutes, Quantity,"Rate (Per Minute)"\n`; // Begin with defined .csv header data
    let fileName, readStream;

    if (StartDate !== EndDate) {
        fileName = `Performance_${LocationID}_${StartDate}_${EndDate}.csv`;
    } else {
        fileName = `Performance_${LocationID}_${StartDate}.csv`;
    }

    // When querying performance reports for a specific location, the location is bound to timezone
    // Convert the UTC time to the location's local time in order to get the exact day, YYYY-MM-DD
    // This means it could be a day earlier, a day later, or on the same UTC day
    // Once you have the location's current local day, it can be used to query on the SQL table: report_performance
    if (!StartDate || !EndDate || !LocationID) {
        res.status(400).json({"message": "StartDate, EndDate, and LocationID are all required!"});
        return;
    }

    if (user.isAdmin || user.isSmanager || user.isWmanager) {
        isManager = true;
    }

    if (isManager) {
        // Display all users
        args = [EndDate, StartDate, LocationID];
        sql = `
            SELECT
                DATE_FORMAT(d.Date, '%Y-%m-%d') AS Date,
                d.LocationID,
                d.UserID,
                d.Task,
                d.Quantity,
                d.Minutes,
                d.HourlyRate
            FROM report_performance d
            WHERE
                d.Date <= ?
                AND d.Date >= ?
                AND d.LocationID = ?
                AND d.UserID != 0 # UserID 0 is system which should not be included
            ORDER BY d.Task, d.UserID, d.Date`;
    } else {
        // Display only one user given by user.id
        args = [EndDate, StartDate, LocationID, EndDate, StartDate, LocationID, user.id];
        sql = `
            SELECT
                DATE_FORMAT(d.Date, '%Y-%m-%d') AS Date,
                d.LocationID,
                d.UserID,
                d.Task,
                d.Quantity,
                d.Minutes,
                d.HourlyRate,
                t.TopRates
            FROM report_performance d
            LEFT JOIN (
                SELECT Task, group_concat(HourlyRate) AS TopRates
                FROM (
                    SELECT HourlyRate, Task
                    FROM (
                        SELECT
                            HourlyRate,
                            Task,
                            @rate_rank := IF(@current_task = Task, @rate_rank +1, 1) AS rate_rank,
                            @current_task := task
                        FROM report_performance
                        WHERE
                            Date <= ?
                            AND Date >= ?
                            AND LocationID = ?
                        ORDER BY Task, HourlyRate DESC
                    ) ranked
                    WHERE rate_rank <= 2
                ) AS top_rates
                GROUP BY Task
            ) AS t on t.Task = d.Task
            WHERE d.Date <= ? AND d.Date >= ?
            AND d.LocationID = ?
            AND d.UserID = ?`;
    }

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("get_performance_reports_csv", {error});
        res.status(500).json({"message": "Error occured while getting preformance Reports."});
        return;
    }


    for (let category of results) {
        let task = category["Task"]; // Need to store the task so it can prepended to each user row (task isn't explicity specified in each user object)
        fileData += await csvConverter.json2csvAsync(category, options) + "\n";

        // Check if the current category has UserData. All categories have user data EXCEPT for "Total"
        if ("UserData" in category) {
            for (let user of category["UserData"]) {
                // Prepend the task that we're currently inspecting
                fileData += task + await csvConverter.json2csvAsync(user, options) + "\n";
            }
        }
    }

    // Create and send a .csv file to the user
    readStream = new stream.PassThrough();
    readStream.end(fileData);
    res.set("Content-disposition", "attachment; filename=" + fileName);
    res.set("Content-Type", "text/csv");
    readStream.pipe(res);
};

exports.prepareRFIDEmail = async function(req, res) {
    let from     = req.body.from     || "";
    let to       = req.body.to       || "";
    let subject  = req.body.subject  || "";
    let body     = req.body.body     || "";
    let rfidlist = req.body.rfidlist || [];
    let sql, args, results;

    let barcodeMap = {};

    // log RFID information
    console.log(`# of items received: ${rfidlist.length}`);
    let c = 0;

    for (let item of rfidlist) {
        if (item.Barcode in barcodeMap) {
            barcodeMap[item.Barcode]++;
        } else {
            barcodeMap[item.Barcode] = 1;
        }
        // Log first 10 items. Do not want to clog logs with all items
        if (c < 10) {
            console.log(`barcode: ${item.Barcode}, EPC: ${item.EPC}`);
            c++;
        }
    }

    let barcodeList = Object.keys(barcodeMap);

    args = [barcodeList];

    sql = `
        SELECT
            pb.Keycode,
            pb.Barcode,
            p.Product_Name,
            p.Item_Size,
            p.Secondary_Colour,
            pd.Name as Department,
            p.Class_Name,
            p.Business_Unit_RBU_Name
        FROM product_barcode pb
        INNER JOIN product p ON p.Keycode = pb.Keycode
        LEFT JOIN product_department pd on pd.ID = p.DepartmentID
        WHERE pb.Barcode IN (?)`;


    // Get Product Information from database


    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.info("prepare_rfid_email ERROR: ", {error});
        res.status(400).json({"message": "Error parsing Keycodes to Barcodes"});
        return;
    }

    let products = {};

    for (let result of results) {
        products[result.Barcode] = result;
    }

    let emaildata = [];

    for (let item of rfidlist) {
        let key, name, size, color, rbu, dep, cl;
        // This is to handle barcodes that are not in our database
        if (products[item.Barcode]) {
            key   = products[item.Barcode].Keycode;
            name  = products[item.Barcode].Product_Name;
            size  = products[item.Barcode].Item_Size;
            color = products[item.Barcode].Secondary_Colour;
            rbu   = products[item.Barcode].Business_Unit_RBU_Name;
            dep   = products[item.Barcode].Department;
            cl    = products[item.Barcode].Class_Name;
        }
        emaildata.push({
            EPC: item.EPC,
            Barcode: item.Barcode,
            Keycode: key || "",
            Name: name || "",
            Size: size || "",
            "Secondary Colour": color || "",
            RBU: rbu || "",
            Dept: dep || "",
            Class: cl || ""
        });
    }

    try {
        body = {
            from: from,
            to: to,
            subject: subject,
            body: body,
            fileData: emaildata
        };

        await apiRequest.post(req, "reports/send_email", body);
    } catch (error) {
        logger.error("prepare_rfid_email:", {error});
        res.status(500).json({"message": "There was an error sending the email"});
        return;
    }

    res.status(200).json({"message": `RFID to Email Send Successfully to ${to}`});

};

exports.sendEmail = async function(req, res) {
    let SES      = new AWS.SES({region: config.email_region, apiVersion: "2010-12-01"});
    let from     = req.body.from     || ""; // The email address that this is coming from
    let to       = req.body.to       || ""; // The email address that this is being sent to
    let subject  = req.body.subject  || ""; // The subject of the email
    let body     = req.body.body     || ""; // Basic text displayed in the body of the email
    let files    = req.body.files    || []; // An array of files to be emailed
    let fileData = req.body.fileData || ""; // File data in the form of a .csv
    // Note: You can send an email to multiple people by having the "to" be a .csv of emails
    // Example: "john.doe@anko.com,jane.doe@anko.com"


    if (!from || !to || !subject) {
        res.status(400).json({"message": "From, To, and Subject are required fields."});
        return;
    }

    if (!body && !files && !fileData) {
        res.status(400).json({"message": "There needs to be data to be emailed."});
        return;
    }

    // Specify the basic mandatory portions of the raw email
    // This includes From, To, Subject, and MIME-Version which must all have a newline
    let data = [
        `From: ${config.email_sender}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        `MIME-Version: 1.0\n`
    ].join("\n");

    /* If you wish to have a text body and an attachment, your first content type MUST be the following:
     * Multipart/Mixed; boundary="NextPart"
     * You can then use "NextPart" to seperate the text body and the attachment.
     * Content-Type is the only required parameter here. Content-Disposition and data are optional */
    let contentTypes = [
        {
            "Content-Type": `Content-type: Multipart/Mixed; boundary="NextPart"`
        },{
            "Content-Type": `Content-Type: text/plain`,
            "data": body
        }
    ];

    if (files) {
        // For each file, update file data from buffer
        for (let i = 0; i < files.length; i++) {
            files[i]["data"] = Buffer.from(files[i]["data"]);
        }

        for (let file of files) {
            contentTypes.push({
                "Content-Type": `Content-Type: text/plain`,
                "Content-Disposition": `Content-Disposition: attachment; filename="${file["name"]}"`,
                "data": file["data"]
            });
        }
    }

    if (fileData) {
        // test
        let csv = await csvConverter.json2csvAsync(fileData, {emptyFieldValue: ""});
        contentTypes.push({
            "Content-Type": `Content-Type: text/plain`,
            "Content-Disposition": `Content-Disposition: attachment; filename="data.csv"`,
            "data": csv
        });
    }

    // Loop through our content types, appending to data and adding newlines where necessary
    // If a particular newline isn't added, then the entire email will be malformed
    for (let obj of contentTypes) {
        if ("Content-Type" in obj) {
            data += obj["Content-Type"] + "\n";
        }

        if ("Content-Disposition" in obj) {
            data += obj["Content-Disposition"] + "\n";
        }

        // An extra newline MUST be added after Content-Type and Content-Disposition
        data += "\n";

        if ("data" in obj) {
            // TWO newlines MUST be added after any data
            data += obj["data"] + "\n\n";
        }

        // The final signature for a content type is --NextPart followed by a newline
        data += "--NextPart\n";
    }

    // You MUST remove the final character in data (which will be a newline), and replace it with two hyphens
    data = data.slice(0, -1) + "--";

    let params = {RawMessage: {Data: data}};

    if (config.isHamiltonEnvironment) {
        params.SourceArn = config.email_arn;
        params.FromArn = config.email_arn;
        params.ReturnPathArn = config.email_arn;
    }

    console.log(params);

    try {
        await SES.sendRawEmail(params).promise();
        res.status(200).json({"message": "Email Sent"});
    } catch (error) {
        logger.info("Unable to send an email", {error});
        res.status(500).json({"message": "Email Failed to Send"});
    }
};

exports.get_performance_reports = async function(req, res) {
    // When querying performance reports for a specific location, the location is bound to timezone
    // Convert the UTC time to the location's local time in order to get the exact day, YYYY-MM-DD
    // This means it could be a day earlier, a day later, or on the same UTC day
    // Once you have the location's current local day, it can be used to query on the SQL table: report_performance
    let StartDate = req.query.StartDate;
    let EndDate = req.query.EndDate;
    let LocationID = req.query.LocationID;
    let user = authHelper.parseRole(req);
    let sql, results, args;
    let isManager = false;

    if (!StartDate || !EndDate || !LocationID) {
        res.status(400).json({"message": "StartDate, EndDate, and LocationID are all required!"});
        return;
    }

    if (user.isAdmin || user.isSmanager || user.isWmanager) {
        isManager = true;
    }

    if (isManager) {
        // Display all users
        args = [EndDate, StartDate, LocationID];
        sql = `Select
                    Task,
                    UserID,
                    Sum(Quantity) as Quantity,
                    Sum(Minutes) as Minutes,
                    Sum(Quantity)/Sum(Minutes) as Rate
                from report_performance
                WHERE
                    Date <= ?
                    AND Date >= ?
                    AND LocationID = ?
                    AND UserID != 0 # UserID 0 is system which should not be included
                GROUP BY Task, UserID
                ORDER BY Task, UserID;`;
        /*sql = `
            SELECT
                DATE_FORMAT(d.Date, '%Y-%m-%d') AS Date,
                d.LocationID,
                d.UserID,
                d.Task,
                d.Quantity,
                d.Minutes,
                d.HourlyRate
            FROM report_performance d
            WHERE
            Date <= ?
            AND Date >= ?
            AND LocationID = ?
            AND UserID != 0 # UserID 0 is system which should not be included
        GROUP BY Task, UserID
        ORDER BY Task, UserID;`;*/
    } else {
        // Display only one user given by user.id
        args = [EndDate, StartDate, LocationID, EndDate, StartDate, LocationID, user.id];
        sql = `
            SELECT
                DATE_FORMAT(d.Date, '%Y-%m-%d') AS Date,
                d.LocationID,
                d.UserID,
                d.Task,
                d.Quantity,
                d.Minutes,
                d.HourlyRate,
                t.TopRates
            FROM report_performance d
            LEFT JOIN (
                SELECT Task, group_concat(HourlyRate) AS TopRates
                FROM (
                    SELECT HourlyRate, Task
                    FROM (
                        SELECT
                            HourlyRate,
                            Task,
                            @rate_rank := IF(@current_task = Task, @rate_rank +1, 1) AS rate_rank,
                            @current_task := task
                        FROM report_performance
                        WHERE
                            Date <= ?
                            AND Date >= ?
                            AND LocationID = ?
                        ORDER BY Task, HourlyRate DESC
                    ) ranked
                    WHERE rate_rank <= 2
                ) AS top_rates
                GROUP BY Task
            ) AS t on t.Task = d.Task
            WHERE d.Date <= ? AND d.Date >= ?
            AND d.LocationID = ?
            AND d.UserID = ?`;
    }

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("get_performance_reports", {error});
        res.status(500).json({"message": "Error occured while getting preformance Reports."});
        return;
    }

    // Process Data into Tree Structure

    /************************
     *  Structure:
     *  task
     *      --> Users
     */

    let data = [];

    if (isManager) {
        let currTask = null;
        let tasks = [];
        let minSum = 0;
        let qtySum = 0;
        for (let result of results) {
            if (!currTask) {
                currTask = result.Task;
            }
            if (currTask != result.Task) {
                let rate = qtySum/minSum;
                data.push({
                    children: tasks,
                    data: {
                        min: minSum,
                        other: currTask,
                        qty: qtySum,
                        rate: rate.toFixed(2)
                    }
                });
                currTask = result.Task;
                tasks = [];
                minSum = 0;
                qtySum = 0;
                rate = +result.Rate;
                tasks.push({
                    data: {
                        min: result.Minutes,
                        other: result.UserID,
                        qty: result.Quantity,
                        rate: rate.toFixed(2)
                    }
                });
                minSum += +result.Minutes;
                qtySum += +result.Quantity;
            } else {
                let rate = +result.Rate;
                tasks.push({
                    data: {
                        other: result.UserID,
                        min: result.Minutes,
                        qty: result.Quantity,
                        rate: rate.toFixed(2)
                    }
                });
                minSum += +result.Minutes;
                qtySum += +result.Quantity;
            }
        }
        if (tasks.length) {
            let rate = qtySum/minSum;
            data.push({
                children: tasks,
                data: {
                    min: minSum,
                    other: currTask,
                    qty: qtySum,
                    rate: rate.toFixed(2)
                }
            });
        }
    }
    /*if (isManager) {
        let currUser = null;
        let currDate = null;
        let currObj = {};
        let tasks = [];
        let dates = [];
        let datetotal = {
            min: 0,
            qty: 0
        };
        let usertotal = {
            min: 0,
            qty: 0
        };
        for (let result of results) {
            let user = result.UserID;
            let task = result.Task;
            let date = result.Date;
            let qty = +result.Quantity;
            let rate = +result.HourlyRate.toFixed(2);
            let min = +result.Minutes;
            if (!currUser) {
                currUser = user;
                currDate = date;
            }

            if (currUser !== user) {
                let dateRate = 0;
                if (datetotal.min) {
                    dateRate = datetotal.qty / datetotal.min;
                }
                dates.push({
                    data: {
                        other: currDate,
                        min: datetotal.min,
                        qty: datetotal.qty,
                        rate: dateRate.toFixed(2)
                    },
                    children: tasks
                });
                let userRate = 0;
                if (usertotal.min) {
                    userRate = usertotal.qty / usertotal.min;
                }
                data.push({
                    data: {
                        other: currUser,
                        min: usertotal.min,
                        qty: usertotal.qty,
                        rate: userRate.toFixed(2)
                    },
                    children: dates
                });
                currUser = user;
                currDate = date;
                tasks = [{
                    data: {
                        other: task,
                        min: min,
                        qty: qty,
                        rate: rate
                    }
                }];
                dates = [];
                datetotal = {
                    min: min,
                    qty: qty
                };
                usertotal = {
                    min: min,
                    qty: qty
                };
            } else {
                if (currDate !== date) {
                    let dateRate = 0;
                    if (datetotal.min) {
                        dateRate = datetotal.qty / datetotal.min;
                    }
                    dates.push({
                        data: {
                            other: currDate,
                            min: datetotal.min,
                            qty: datetotal.qty,
                            rate: dateRate.toFixed(2)
                        },
                        children: tasks
                    });
                    currDate = date;
                    tasks = [{
                        data: {
                            other: task,
                            min: min,
                            qty: qty,
                            rate: rate
                        }
                    }];
                    dates = [];
                    datetotal = {
                        min: min,
                        qty: qty
                    };
                    usertotal.min += min;
                    usertotal.qty += qty;
                } else {
                    tasks.push({
                        data: {
                            other: task,
                            min: min,
                            qty: qty,
                            rate: rate
                        }
                    });
                    datetotal.min += min;
                    datetotal.qty += qty;
                    usertotal.min += min;
                    usertotal.qty += qty;
                }
            }

        }
        if (currUser) {
            let dateRate = 0;
            if (datetotal.min) {
                dateRate = datetotal.qty / datetotal.min;
            }
            dates.push({
                data: {
                    other: currDate,
                    min: datetotal.min,
                    qty: datetotal.qty,
                    rate: dateRate.toFixed(2)
                },
                children: tasks
            });
            let userRate = 0;
            if (usertotal.min) {
                userRate = usertotal.qty / usertotal.min;
            }
            data.push({
                data: {
                    other: currUser,
                    min: usertotal.min,
                    qty: usertotal.qty,
                    rate: userRate.toFixed(2)
                },
                children: dates
            });
        }
    }*/ else {
        let currUser = null;
        let currDate = null;
        let currObj = {};
        let tasks = [];
        let dates = [];
        let datetotal = {
            min: 0,
            qty: 0
        };
        for (let result of results) {
            let task = result.Task;
            let date = result.Date;
            let qty = +result.Quantity;
            let rate = +result.HourlyRate.toFixed(2);
            let top_rates = results.TopRates;
            let min = +result.Minutes;
            if (!currDate) {
                currDate = date;
            }

            if (currDate !== date) {
                let dateRate = 0;
                if (datetotal.min) {
                    dateRate = datetotal.qty / datetotal.min;
                }
                data.push({
                    data: {
                        other: currDate,
                        min: datetotal.min,
                        qty: datetotal.qty,
                        rate: dateRate.toFixed(2),
                        top_rates: ""
                    },
                    children: tasks
                });
                currDate = date;
                tasks = [{
                    data: {
                        other: task,
                        min: min,
                        qty: qty,
                        rate: rate,
                        top_rates: top_rates
                    }
                }];
                dates = [];
                datetotal = {
                    min: min,
                    qty: qty
                };
            } else {
                tasks.push({
                    data: {
                        other: task,
                        min: min,
                        qty: qty,
                        rate: rate,
                        top_rates: top_rates
                    }
                });
                datetotal.min += min;
                datetotal.qty += qty;
            }
        }
        if (currDate) {
            let dateRate = 0;
            if (datetotal.min) {
                dateRate = datetotal.qty / datetotal.min;
            }
            data.push({
                data: {
                    other: currDate,
                    min: datetotal.min,
                    qty: datetotal.qty,
                    rate: dateRate.toFixed(2),
                    top_rates: ""
                },
                children: tasks
            });
        }
    }

    res.status(200).json({"data": data, "isManager": isManager});
};

exports.get_inventory_report_csv = async function(req, res) {
    let date = req.query.Date;
    let location = req.query.LocationID;
    let S3 = new AWS.S3({region: config.email_region});
    let key = `StoreReports/${location}/${location}_InventoryReport_${date}.csv`;
    let fileName = `${location}_InventoryReport_${date}.csv`;
    let reportBucketName = config.s3_bucket.reports;
    let params = {
        Bucket: reportBucketName,
        Key: key
    };
    let report, readStream;

    try {
        report = await S3.getObject(params).promise();
    } catch (error) {
        logger.error("get_inventory_report_csv", {error});
        res.status(500).json({"message": "Error occured while retriving the Inventory Report."});
        return;
    }

    res.set("Content-disposition", "attachment; filename=" + fileName);
    res.set("Content-Type", "text/csv");
    readStream = new stream.PassThrough();
    readStream.end(report.Body);
    readStream.pipe(res);
};

exports.send_barcodes_to_email = async function(req, res) {
    let barcodes = req.body.barcodes;
    let email = req.body.email;
    // let sql, args, results, keycodes;

    let data = {
        "barcodes": barcodes,
        "email": email
    };
    try {
        await axios.post(config.barcode_to_email_api, data);
        res.status(200).json({"message": "file sent successfully"});
    } catch (error) {
        res.status(500).json({"message": error});
    }
};

exports.get_inbound_dashboard = async function(req, res) {
    let LocationID = req.query.LocationID;
    let sql, args, results;

    if (!LocationID) {
        res.status(400).json({"message": "LocationID is required! Please provide valid Warehouse Location ID."});
        return;
    }

    sql = `
        SELECT
            tg.SourceLocation AS InboundSource,
            tg.Priority,
            tg.DateDue AS ETA,
            SUM(t.QuantityFilled) AS UnitsTotal,
            SUM(IFNULL(t.QuantityDelivered, IF(DateTransitEnd IS NULL, 0, IFNULL(t.QuantityFilled, t.Quantity)))) AS UnitsDelivered,
            SUM(IFNULL(t.QuantityDelivered, 0)) AS UnitsReceived,
            GROUP_CONCAT(DISTINCT IF(t.DateTransitEnd IS NULL AND t.DateFulfilled IS NULL, t.TargetContainer, NULL)) AS UnDeliveredCarts,
            GROUP_CONCAT(DISTINCT IF(t.DateTransitEnd IS NOT NULL AND t.DateFulfilled IS NULL, t.TargetContainer, NULL)) AS DeliveredCarts,
            GROUP_CONCAT(DISTINCT IF(t.DateFulfilled IS NOT NULL, t.TargetContainer, NULL)) AS ReceivedCarts
        FROM (
            SELECT
                ID AS Location,
                CONVERT_TZ(DATE(CONVERT_TZ(NOW(), 'UTC', Timezone)), Timezone, 'UTC') AS Today,
                Timezone
            FROM location WHERE ID = ?
        ) AS loc
        INNER JOIN task_group tg ON tg.TargetLocation = loc.Location AND tg.Type = 'Pick'
        INNER JOIN task t ON t.TaskGroupID = tg.ID
        WHERE tg.DateDue > loc.Today OR (tg.DateFulfilled IS NULL AND tg.DateDue > DATE_ADD(loc.Today, INTERVAL -30 DAY))
        GROUP BY tg.TargetLocation, tg.Priority, tg.DateDue
        ORDER BY tg.DateDue, tg.Priority`;

    args = [LocationID];

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("reports_get_dashboard", {error});
        res.status(500).json({"message": "Error occured while retriving the Dashboard data."});
        return;
    }

    res.status(200).json({"data": results});
};

exports.get_backfill_dashboard = async function(req, res) {
    let LocationID = req.query.LocationID; // Location with Front-House/Back-House enabled
    let sql, args, results;
    if (!LocationID) {
        res.status(400).json({"message": "LocationID is required! Please provide valid Location ID."});
        return;
    }

    sql = ` SELECT hasFHBH from location where ID = ?`;
    args = [LocationID];

    try {
        [results] = await ro_pool.query(sql, args);

        if (!results.length) {
            res.status(400).json({"message": "Please provide valid Location ID."});
            return;
        }

        if (!results[0].hasFHBH) {
            res.status(400).json({"message": "Location is not a valid store with Front-House/Back-House enabled"});
            return;
        }
    } catch (error) {
        logger.error("reports_get_backfill_dashboard", {error});
        res.status(500).json({"message": "Error occured while retriving the backfill Dashboard provided location information."});
        return;
    }

    sql = `
        SELECT
            Type,
            TargetLocation,
            Priority,
            DateDue,
            DateCreated,
            (uTotal - uBackup) AS UnitsTotal,
            (uTotal - uPicked - uUnavailableAll) AS UnitsToDo,
            uPicked AS UnitsPicked,
            (uUnavailableSystem - uBackup) AS UnitsUnavailable,
            uExpired AS UnitsExpired,
            (uTotal - uBackup) - (uUnavailableAll - uBackup) AS UnitsStoreTotal,
            (CASE WHEN uDelivered > 0 THEN uDelivered - uBackup ELSE 0 END) AS UnitsDelivered,
            TaskGroupIDs,
            storeBackfillName,
            storeBackfillID
        FROM (
            SELECT
                tg.Type,
                tg.TargetLocation,
                tg.Priority,
                tg.DateDue,
                tg.DateCreated,
                SUM(t.Quantity) AS uTotal,
                SUM(CASE WHEN t.isBackup = 1 THEN t.Quantity ELSE 0 END) AS uBackup,
                IFNULL(SUM(t.QuantityFilled), 0) AS uPicked,
                SUM(CASE WHEN t.DateCompleted IS NOT NULL AND t.AssignedUserID IS NULL THEN t.Quantity ELSE 0 END) AS uExpired,
                IFNULL(SUM(t.QuantityDelivered), 0) AS uDelivered,
                # We need two different "Unavailable" values, one for all unavailables, and another of only those without user intervention
                IFNULL(SUM(CASE WHEN t.QuantityFilled IS NOT NULL AND t.DateCompleted IS NOT NULL                                  THEN t.Quantity - t.QuantityFilled ELSE 0 END), 0) AS uUnavailableAll,
                IFNULL(SUM(CASE WHEN t.QuantityFilled IS NOT NULL AND t.DateCompleted IS NOT NULL AND t.AssignedUserID IS NOT NULL THEN t.Quantity - t.QuantityFilled ELSE 0 END), 0) AS uUnavailableSystem,
                GROUP_CONCAT(DISTINCT tg.ID) AS TaskGroupIDs,
                sbs.ID AS storeBackfillID,
                sbs.Name AS storeBackfillName
            FROM (
                SELECT ID AS Location, CONVERT_TZ(DATE(CONVERT_TZ(NOW(), 'UTC', Timezone)), Timezone, 'UTC') AS Today, Timezone
                FROM location WHERE ID = ? AND hasFHBH = 1
            ) AS base
            INNER JOIN task_group tg ON tg.SourceLocation = base.Location AND tg.Type in ('Backfill')
            INNER JOIN task t ON t.TaskGroupID = tg.ID
            INNER JOIN store_backfill_schedule sbs ON tg.ReferenceID = sbs.ID
            WHERE (tg.DateDue > base.Today OR (tg.DateFulfilled IS NULL AND tg.DateDue = base.Today))
            AND tg.DateCreated >= DATE_ADD(base.Today, INTERVAL -5 DAY)
            GROUP BY tg.TargetLocation, tg.Priority, tg.DateDue, sbs.ID
            ORDER BY tg.Type, tg.DateDue, tg.TargetLocation
        ) AS a ORDER BY DateCreated DESC
        ;
        SELECT
            tg.ID, tg.Source, tg.Name
        FROM (
            SELECT ID AS Location, CONVERT_TZ(DATE(CONVERT_TZ(NOW(), 'UTC', Timezone)), Timezone, 'UTC') AS Today, Timezone
            FROM location WHERE ID = ? and hasFHBH = 1
        ) AS base
        INNER JOIN task_group tg ON tg.SourceLocation = base.Location AND tg.Type in ('Backfill')
        WHERE tg.DateDue > base.Today OR (tg.DateFulfilled IS NULL AND tg.DateDue = base.Today)`;
    args = [LocationID, LocationID];

    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("reports_get_backfill_dashboard", {error});
        res.status(500).json({"message": "Error occured while retriving the backfill Dashboard data."});
        return;
    }
    let tgs = results[1];
    let taskgroups = {};
    for (const tg of tgs ) {
        taskgroups[tg.ID] = {
            source: tg.Source,
            name: tg.Name
        };
    }

    res.status(200).json({"data": results[0], "taskgroups": taskgroups});
};

exports.generate_backfill_efficacy_report = async function (req, res) {
    /* This will create a report file that contains the following information:
     * 1.  Location ID
     * 2.  Keycode
     * 3.  Product Name
     * 4.  Department Name
     * 5.  MDU
     * 6.  OOS KC
     * 7.  STR Yesterday (STR: Quantity in Front-of-House yesterday)
     * 8.  BOH Yesterday (BOH: Quantity in Back-of-House yesterday)
     * 9.  STR Current (STR: Quantity in Front-of-House Current)
     * 10. BOH Current (BOH: Quantity in Back-of-House Current)
     * 11. Backfill Generated
     * 12. Backfill Performed
     * 13. Backfilled but OOS today?
     * 14. Qty_Picked
     * 15. Qty_Unavailable
     * 16. Qty_Expired
     *
     * Also creates the backfill efficacy metric report
     * 1. LocationID
     * 2. InStockPercentage
     * 3. OOSDueToSystemNotGeneratingBackfill
     * 4. OOSDueToBackfillNotPerformed
     * 5. OOSDueToLessMDU
     *
     * Create 2 report and uploads it to s3 bucket, sends SNS email notification
     */
    let locationID = req.query.locationID || null;

    if (!locationID) {
        res.status(400).json({"message": "locationID is required! Please provide a valid locationID."});
        return;
    }

    let sql, args, results;
    let productInfo = {}; // Product information that will be recorded and pushed into data
    let data = [];        // Array which will contain the final data to create a .csv
    let fileData, date, fileName, timezone, backfillEfficacyResults, backfillEfficacyMetricResults;
    let backfillEfficacykey, backfillEfficacyMetricKey;

    // A location ID is always four digits, followed by a hyphen, followed by the location type
    // Examples: 1154-STR, 1156-STR, 1284-STR
    // Simply split by the hyphen and take the 0th index to get the four-digit store number, which is used for emails
    let storeNumber = locationID.split("-")[0];

    // Options for creating the .csv file
    let options = {
        checkSchemaDifferences: false, // Stores may have a different number of unique container types
        emptyFieldValue: "",
        prependHeader: true
    };

    sql = `CALL ${config.sql_database_for_sp}.backfill_generate_efficacy_report(?)`;
    args = [locationID];

    try {
        // The stored procedure backfill_generate_efficacy_report only calls SELECT and
        // CREATE/DROP TEMPORARY TABLE, so it's safe for us to execute on the read-only DB
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("generate_backfill_efficacy_report(Getting Data from SP):", {error});
        res.status(500).send({"message": `There was an error in generating a report for Backfill Efficacy`});
        return;
    }

    backfillEfficacyResults = results[0];
    backfillEfficacyMetricResults = results[1];

    if (backfillEfficacyResults.length === 0) {
        res.status(400).json({"message": `There are no results to be generated for the backfill efficacy report`});
        return;
    }

    timezone = backfillEfficacyResults[0]["Timezone"];

    for (let row of backfillEfficacyResults) {
        let locationID = row["LocationID"];
        let keycode    = row["Keycode"];
        let name       = row["Product_Name"];
        let department = row["Department_Name"];
        let mdu        = row["MDU"];
        let InOrOutOfStock = row["InOrOutOfStock"];
        let FOHQuantityYesterday = parseInt(row["FOHQuantityYesterday"]);
        let BOHQuantityYesterday = parseInt(row["BOHQuantityYesterday"]);
        let FOHQuantityCurrent = parseInt(row["FOHQuantityCurrent"]);
        let BOHQuantityCurrent = parseInt(row["BOHQuantityCurrent"]);
        let BackfillGenerated = row["BackfillGenerated"];
        let BackfillPerformed = row["BackfillPerformed"];
        let BackfilledButOutOfStockToday = row["BackfilledButOutOfStockToday"];
        let Qty_Picked = row["Qty_Picked"];
        let Qty_Unavailable = row["Qty_Unavailable"];
        let Qty_Expired = row["Qty_Expired"];

        productInfo = {
            Location: locationID,
            Keycode: keycode,
            Product_Name: name,
            Department_Name: department,
            MDU: mdu,
            "OOS KC": InOrOutOfStock,
            "STR Yesterday": FOHQuantityYesterday,
            "BOH Yesterday": BOHQuantityYesterday,
            "STR Current": FOHQuantityCurrent,
            "BOH Current": BOHQuantityCurrent,
            "Backfill Genereated": BackfillGenerated,
            "Backfill Performed ?": BackfillPerformed,
            "Backfilled but OOS today ?": BackfilledButOutOfStockToday,
            "Qty_Picked": Qty_Picked,
            "Qty_Unavailable": Qty_Unavailable,
            "Qty_Expired": Qty_Expired
        };

        // Push the final productInfo into data
        data.push(productInfo);
    }

    // S3 parameters such that it will work in the internal AWS account
    let additionalParameters = {
        StorageClass        : "STANDARD",
        ACL                 : "private",
        ServerSideEncryption: "AES256"
    };

    fileData = await csvConverter.json2csvAsync(data, options) + "\n";

    date = moment().tz(timezone).format("YYYY-MM-DD_HH-mm");
    fileName = `backfill-efficacy-${locationID}-${date}.csv`;
    backfillEfficacykey = `${config.env_type}-backfill-efficacy/${locationID}/${fileName}`;
    await helper.uploadFileToS3(config.s3_bucket.logging, backfillEfficacykey, fileData, true, additionalParameters);

    fileData = await csvConverter.json2csvAsync(backfillEfficacyMetricResults, options) + "\n";
    fileName = `backfill-efficacy-metric-${locationID}-${date}.csv`;
    backfillEfficacyMetricKey = `${config.env_type}-backfill-efficacy-metric/${locationID}/${fileName}`;
    await helper.uploadFileToS3(config.s3_bucket.logging, backfillEfficacyMetricKey, fileData, true, additionalParameters);

    // Stopping sending Backfill Efficacy Reports to store Managers
    /*if (config.backfillReportSnsTopicArn) {
        // The email should be sent to the store managers, which have an email pattern of: kXXXXma01@kmart.com.au
        // XXXX is the four-digit store number
        const from = config.email_sender;
        const to = `k${storeNumber}ma01@kmart.com.au`;
        const subject = `Backfill efficacy Report ${locationID} ${date}`;
        const body = `
            Hi,
            Below is the Backfill Efficacy Report Download URL for Location ${locationID}:

            Backfill Efficacy Metric: ${config.base_url}/api/reports/download_backfill_efficacy_report?FileName=${backfillEfficacyMetricKey}
            Backfill Efficacy : ${config.base_url}/api/reports/download_backfill_efficacy_report?FileName=${backfillEfficacykey}

            Thanks!`;

        await apiRequest.post(req, "reports/send_email", {
            from: from,
            to: to,
            subject: subject,
            body: body
        });
    }*/

    res.status(200).json({"message": "The backfill efficacy report & metric report has been generated and uploaded to S3"});
};

exports.list_backfill_efficacy_reports = async function (req, res) {
    let BucketPrefixAndKeyName = req.query.BucketPrefixAndKeyName;
    let LocationID = req.query.LocationID;
    let s3 = new AWS.S3();
    let files = [];
    let keys = [];
    let response, BucketPrefix;

    if (!LocationID || !BucketPrefixAndKeyName) {
        res.status(400).json({"message": "LocationID, BucketPrefixAndKeyName are required!"});
        return;
    }

    BucketPrefix = `${config.env_type}-${BucketPrefixAndKeyName}/${LocationID}/${BucketPrefixAndKeyName}-${LocationID}`;

    // We'll want to get all of the current month's reports, and last month's reports
    let thisMonth = moment().format("YYYY-MM");
    let previousMonth = moment().subtract(1, "month").format("YYYY-MM");

    // Initialize the parameters for the first call of s3.listObjectsV2
    let params = {
        Bucket: config.s3_bucket.logging,
        Prefix: `${BucketPrefix}-${thisMonth}`,
    };

    try {
        response = await s3.listObjectsV2(params).promise();
        for (let item of response.Contents) {
            keys.push(item.Key);
        }
    } catch (error) {
        logger.error("list_backfill_efficacy_reports", {error});
        res.status(500).json({"message": "Unable to download the backfill efficacy report"});
        return;
    }

    // Update the prefix for the second call of s3.listObjectsV2
    params.Prefix = `${BucketPrefix}-${previousMonth}`;

    try {
        response = await s3.listObjectsV2(params).promise();
        for (let item of response.Contents) {
            keys.push(item.Key);
        }
    } catch (error) {
        logger.error("list_backfill_efficacy_reports", {error});
        res.status(500).json({"message": "Unable to download the backfill efficacy report"});
        return;
    }

    for (let key of keys) {
        // Example key: dev-backfill-efficacy/backfill-efficacy-2020-10-14_12-00.csv
        // Format:      dev-backfill-efficacy/backfill-efficacy-YYYY-MM-DD_HH-mm.csv
        let data = key.split(`${BucketPrefixAndKeyName}-${LocationID}`)[1].split(".csv")[0];
        let date = data.split("_")[0];
        let time = data.split("_")[1];
        let sort = moment(`${date}_${time}`, "YYYY-MM-DD_HH-mm");

        date = moment(date, "YYYY-MM-DD").format("dddd, MMM D YYYY");
        time = moment(time, "HH-mm").format("h:mma");
        files.push({key: key, date: `${date}, ${time}`, sort: sort});
    }

    // Perform a custom sort, in which the most recent files will appear first
    files.sort(function (a, b) {
        if (a.sort.isBefore(b.sort)) {
            return 1;
        } else if (a.sort.isAfter(b.sort)) {
            return -1;
        } else {
            return 0;
        }
    });

    res.status(200).json({data: files});
};

exports.download_backfill_efficacy_report = async function (req, res) {
    let s3 = new AWS.S3();
    let readStream = new stream.PassThrough();
    let key = req.query["FileName"] || null;
    let params = {
        Bucket: config.s3_bucket.logging,
        Key   : key
    };
    let fileName, fileData;

    if (!key) {
        res.status(400).json({"message": "FileName is required"});
        return;
    }

    // Remove the S3 directory from the file's key
    // Example key: dev-backfill-efficacy/backfill-efficacy-2020-10-13_11-42.csv
    let splitArray = key.split("/");
    fileName = splitArray[splitArray.length - 1 ];

    try {
        let result = await s3.getObject(params).promise();
        fileData = result.Body;
    } catch (error) {
        logger.error("download_backfill_efficacy_report", {error});
        res.status(500).json({"message": "Unable to download the backfill efficacy report"});
        return;
    }

    res.set("Content-disposition", "attachment; filename=" + fileName);
    res.set("Content-Type", "text/csv");
    readStream.end(fileData);
    readStream.pipe(res);
};

exports.get_active_users = async function(req, res) {
    let currentLocation = req.query.LocationID;
    let dynamoItems = [];
    let userMap = {};
    let sql, args, results, response;

    // Get the timezone associated with the current location
    try {
        sql = `SELECT Timezone FROM location WHERE ID = ?`;
        args = [currentLocation];
        [results] = await pool.query(sql, [args]);
    } catch (error) {
        res.status(500).json({"message": `An error occured while getting the active users, please contact your administrator`});
        console.log(error);
        return;
    }

    // Validate that the requested store exists
    if (results.length === 0) {
        res.status(400).json({"message": `The store ${currentLocation} doesn't exist`});
        return;
    }

    // Get the current day for the relevant timezone in the format: YYYY-MM-DD
    let timezone = results[0]["Timezone"];
    let currentDate = moment.tz(timezone).format("YYYY-MM-DD");
    let pagination = {};
    let params = {
        "TableName": config.dynamodb.task_log,
        "KeyConditionExpression": "#Date = :currentDay",      // Get by the sort key first...
        "FilterExpression": "#LocationID = :currentLocation", // ...and filter out irrelevant locations second
        "ExpressionAttributeNames": {
            "#Date": "Date",
            "#LocationID": "LocationID"
        },
        "ExpressionAttributeValues": {
            ":currentDay": currentDate,
            ":currentLocation": currentLocation
        }
    };

    // Query the DynamoDB table, getting all of today's user task data
    do {
        response = await dynamodb.query(params).promise();
        dynamoItems = [...dynamoItems, ...response.Items];
        pagination = response.LastEvaluatedKey;
        params.ExclusiveStartKey = pagination;
    } while (response.hasOwnProperty("LastEvaluatedKey"));

    // Prepare SQL for getting the names of the active user list
    sql = `SELECT ID, CONCAT(FirstName, ' ', LastName) AS Name FROM user WHERE ID IN ?`;
    args = [];

    /* After retrieving the user task data from DynamoDB, we need to get the latest task from each unique user.
     * There are several properties in each item, but there's only three that are needed for this use case:
     * 1. UserID
     * 2. TaskType
     * 3. DateStart */
    for (let item of dynamoItems) {
        let userID = item.UserID;
        let taskType = item.TaskType;
        let timestamp = item.DateStart;

        // Immediately add the user into the user map if their ID doesn't exist in it yet
        if (!(userID in userMap)) {
            args.push(userID);
            userMap[userID] = {
                Process: taskType,
                timestamp: timestamp
            };
        } else {
            // If the user already exists in the user map, update the Process and timestamp
            // properties if the current timestamp occurs after the already recorded one
            let oldTimestamp = userMap[userID].timestamp;
            let isNewerTimestamp = moment(timestamp).isAfter(oldTimestamp);

            if (isNewerTimestamp) {
                userMap[userID] = {
                    Process: taskType,
                    timestamp: timestamp
                };
            }
        }
    }

    // Now that the latest user task has been retrieved from the collection of dynamo items,
    // we need to get all of the first/last names of the users
    try {
        [results] = await ro_pool.query(sql, [[args]]);
    } catch (error) {
        res.status(500).json({"message": `An error occured while getting the active users, please contact your administrator`});
        console.log(error);
        return;
    }

    /* Using the two objects, the "Process" property can be added
     * into the "results" object which is sent as the response
     *
     * Sample data structure of "userMap"
     * {
     *     "782": { Process: "LOGIN",  timestamp: "2021-04-06 07:02:49" },
     *     "783": { Process: "LOGOUT", timestamp: "2021-04-06 06:36:43" },
     *     "784": { Process: "LOGIN",  timestamp: "2021-04-06 06:21:21" }
     * }
     *
     * Sample data structure of "results"
     * [
     *     { ID: 782, Name: "Leif Coleman" },
     *     { ID: 783, Name: "Jolly Patel"  },
     *     { ID: 784, Name: "Jiri Vetyska" }
     * ]
     */
    for (let i = 0; i < results.length; i++) {
        let id = results[i].ID;
        results[i].Process = userMap[id].Process;
    }

    res.status(200).json({"data": results});
};

exports.get_active_user_task = async function(req, res) {
    let userId    = req.query.UserID || null;
    let tableName = config.dynamodb.task_log;
    let tasks     = {};
    let results, params, items;

    params = {
        TableName: tableName,
        ProjectionExpression: "UserID, TaskType, DateStart",
        KeyConditionExpression: "#Date = :Date",
        ExpressionAttributeNames: {
            "#Date": "Date"
        },
        ExpressionAttributeValues: {
            ":Date": moment().tz("America/Los_Angeles").format("YYYY-MM-DD")
        }
    };

    // If a user ID was given, add additional parameters to have DynamoDB filter out everything that ISN'T the current user
    // If a user's ID wasn't provided, then it will query tasks for all users
    if (userId) {
        params["ExpressionAttributeNames"]["#UserID"]  = "UserID";
        params["ExpressionAttributeValues"][":UserID"] = parseInt(userId);
        params["FilterExpression"] = "#UserID = :UserID";
    }

    try {
        results = await dynamodb.query(params).promise();
    } catch (error) {
        logger.error("get_active_user_task: ", {error});
        res.status(500).json({"message": "Unable to get the active user's task"});
        return;
    }

    // Return NULL if no results were found
    if (results.Count == 0) {
        res.status(200).json({"data": null});
        return;
    }

    /* Data will be in results.Items if the Count > 0
     * [
     *     {
     *         UserID: "41",
     *         TaskType: "w-stow",
     *         DateStart: "2019-10-29T19:27:24+00:00"
     *     },{
     *         ...etc...
     *     }
     * ]
     *
     * Results from DynamoDB will NOT be ordered by the DateStart, so it must be done now
     * Sort the items so that tasks are ordered with the most recent being at the index 0
     */
    items = results["Items"];
    items.sort((a, b) => {
        let aTime = moment(a.DateStart).valueOf();
        let bTime = moment(b.DateStart).valueOf();

        if (aTime > bTime) {
            return -1;
        } else if (aTime < bTime) {
            return 1;
        }

        return 0;
    });

    for (let item of items) {
        // item example: { UserID: 2, TaskType: "Driving", DateStart: "2020-05-28T17:27:05-07:00" }
        if (!(item.UserID in tasks)) {
            tasks[item.UserID] = {
                "task": item.TaskType,
                "date": item.DateStart
            };
        }
    }

    /* Example of tasks:
     * {
     *     2:    { task: "driving", date: "2020-05-28T17:27:05-07:00" },
     *     1234: { task: "break", date: "2020-05-28T16:57:03-07:00" },
     *     5678: { task: "other", date: "2020-05-28T17:01:41-07:00" }
     * }
     */
    res.status(200).json({"data": tasks});
};

exports.get_inventory_bot_dashboard = async function(req, res) {
    const LocationID = req.query.LocationID;
    let sql, args, results;

    if (!LocationID) {
        res.status(400).json({"message": "LocationID is required! Please provide valid Location ID."});
        return;
    }

    sql = `
        SELECT
            ib.ID,
            ib.Name,
            ib.LocationID,
            ibm.MapUrl,
            ibm.MapHeight,
            ibm.MapWidth,
            bp.RunName,
            bph.DateCreated AS StartTime,
            bph.DateUpdated AS EndTime,
            loc.Timezone,
            bp.TaskConfig AS Area,
            bp.Status,
            bph.ScanArea,
            bph.IsManual,
            bph.NumTagsRead,
            bph.NumTagsProcessed,
            bph.FailureReason,
            bph.FailureComment,
            ROUND(bph.AverageCertainty, 3) AS AverageCertainty,
            bph.RunQualityPct,
            ibm1.MapUrl as RunMapUrl,
            ibm1.MapHeight as RunMapHeight,
            ibm1.MapWidth as RunMapWidth,
            bps.BatteryPct,
            bps.CompletedWaypoints,
            bps.EPCsCounted
        FROM inventory_bot ib
        INNER JOIN inventory_bot_area iba ON ib.ID = iba.InventoryBotID AND ib.DefaultMap = iba.Map
        INNER JOIN bot_process bp ON bp.InventoryBotID = ib.ID AND bp.TaskConfig = iba.Area
        INNER JOIN location loc ON ib.LocationID = loc.ID
        LEFT JOIN bot_process_history bph ON bph.Name = bp.RunName AND bph.InventoryBotID = ib.ID
        LEFT JOIN (
            SELECT MAX(RowID) AS RowID, BotProcessHistoryID, Status FROM bot_process_status
            GROUP BY BotProcessHistoryID, Status
        ) maxBotProcessStatus ON maxBotProcessStatus.BotProcessHistoryID = bph.ID AND maxBotProcessStatus.Status = bph.Status
        LEFT JOIN bot_process_status bps ON maxBotProcessStatus.RowID = bps.RowID
        LEFT JOIN inventory_bot_map ibm ON ib.MapID = ibm.ID
        LEFT JOIN inventory_bot_map ibm1 ON ibm1.ID = bph.MapID
        WHERE ib.LocationID = ?
        GROUP BY ib.ID, iba.Area
        ORDER BY bp.DateUpdated DESC`;

    args = [LocationID];
    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("Error get_inventory_bot_dashboard:", {error});
        res.status(500).json({"message": `Error occured while retriving the Inventory Bot Dashboard data.`});
        return;
    }

    res.status(200).json({"data": results});
};

exports.get_filtered_rfid_tags_csv = async function(req, res) {
    const LocationID = req.query.LocationID;
    let sql, args, results, readStream, fileData;
    let options = {emptyFieldValue: "", keys: ["LocationID", "ID", "Barcode", "TagID", "XPosition", "YPosition", "ZPosition", "Certainty", "MapAreaID", "RunName", "InventoryBotID", "Reason", "DateCreated"]}; // Options for .csv file
    const fileName = `Filtered_RFID_Tags_${LocationID}.csv`;

    if (!LocationID) {
        res.status(400).json({"message": "LocationID is required! Please provide valid Location ID."});
        return;
    }

    sql = `
        SELECT
            ib.LocationID,
            fet.*
        FROM filtered_epc_tags fet
        INNER JOIN inventory_bot ib ON fet.InventoryBotID = ib.ID
        WHERE ib.LocationID = ?`;

    args = [LocationID];
    try {
        [results] = await ro_pool.query(sql, args);
    } catch (error) {
        logger.error("Error get_filtered_rfid_tags_csv:", {error});
        res.status(500).json({"message": `Error occured while getting filtered RFID tags data.`});
        return;
    }

    fileData = await csvConverter.json2csvAsync(results, options);

    // Create and send a .csv file to the user
    readStream = new stream.PassThrough();
    readStream.end(fileData);
    res.set("Content-disposition", "attachment; filename=" + fileName);
    res.set("Content-Type", "text/csv");
    readStream.pipe(res);
};

exports.get_stocktake_dashboard = async function(req, res) {
    let LocationID = req.query.LocationID;
    let sql, args, results;

    if (!LocationID) {
        res.status(400).json({"message": "LocationID is required! Please provide valid Location ID."});
        return;
    }

    sql = `
            SELECT
            Type,
            TargetLocation
            Priority,
            DateDue,
            DateCreated,
            KeycodesTotal,
            KeycodesCompleted,
            UnitsTotal,
            UnitsDone,
            (UnitsTotal - UnitsDone - UnitsUnavailable) AS UnitsToDo,
            UnitsUnavailable,
            UnitsExpired,
            TaskGroupIDs,
            storeBackfillID,
            storeBackfillName,
            keycodesToCheck,
            hoursToComplete,
            keyCodesOverThreshold
            FROM (
                SELECT
                    tg.Type,
                    tg.TargetLocation,
                    tg.Priority,
                    tg.DateDue,
                    tg.DateCreated,
                    COUNT(DISTINCT t.Keycode) AS KeycodesTotal,
                    COUNT(DISTINCT CASE WHEN t.DateCompleted IS NOT NULL THEN t.Keycode ELSE NULL END) AS KeycodesCompleted,
                    SUM(t.Quantity) AS UnitsTotal,
                    IFNULL(SUM(t.QuantityFilled), 0) AS UnitsDone,
                    SUM(CASE WHEN t.DateFulfilled IS NOT NULL AND t.AssignedUserID IS NULL THEN t.Quantity ELSE 0 END) AS UnitsExpired,
                    IFNULL(SUM(CASE WHEN t.QuantityFilled IS NOT NULL AND t.DateCompleted IS NOT NULL AND t.AssignedUserID IS NOT NULL THEN t.Quantity - t.QuantityFilled ELSE 0 END), 0) AS UnitsUnavailable,
                    GROUP_CONCAT(DISTINCT tg.ID) AS TaskGroupIDs,
                    sbs.ID AS storeBackfillID,
                    sbs.Name AS storeBackfillName,
                    sbs.keycodesToCheck,
                    sbs.hoursToComplete,
                    IFNULL(sis.numRowsOverThreshold, 0) AS keyCodesOverThreshold
                FROM (
                    SELECT
                        loc.ID AS Location,
                        CONVERT_TZ(DATE(CONVERT_TZ(NOW(), 'UTC', loc.Timezone)), loc.Timezone, 'UTC') AS Today,
                        loc.Timezone
                    FROM location loc
                    WHERE loc.ID = ?
                ) AS base
                INNER JOIN task_group tg ON tg.SourceLocation = base.Location AND tg.Type in ('Inventory')
                INNER JOIN task t ON t.TaskGroupID = tg.ID
                LEFT JOIN store_backfill_schedule sbs ON tg.ReferenceID = sbs.ID
                LEFT JOIN (
                    SELECT
                        sis.BackfillScheduleID,
                        COUNT(DISTINCT sis.Keycode) AS numRowsOverThreshold,
                        DATE(CONVERT_TZ(sis.DateCreated, 'UTC', loc.Timezone)) AS dateSnapshotCreated,
                        loc.Timezone
                    FROM store_inventory_snapshot sis
                    INNER JOIN location loc ON sis.LocationID = loc.ID
                    WHERE
                        sis.TaskID IS NULL
                        AND sis.IsOverThreshold
                        AND sis.LocationID = ?
                    GROUP BY sis.BackfillScheduleID, dateSnapshotCreated
                ) AS sis ON sbs.ID = sis.BackfillScheduleID AND DATE(CONVERT_TZ(tg.DateCreated, 'UTC', sis.Timezone)) = sis.dateSnapshotCreated
                WHERE (tg.DateDue > base.Today OR (tg.DateFulfilled IS NULL AND tg.DateDue = base.Today))
                AND tg.DateCreated >= DATE_ADD(base.Today, INTERVAL -5 DAY)
                GROUP BY tg.TargetLocation, tg.Priority, tg.DateDue, sbs.ID
                ORDER BY tg.Type, tg.DateDue, tg.TargetLocation
            ) AS a ORDER BY DateCreated DESC
        `;
    args = [LocationID, LocationID];

    try {
        [results] = await pool.query(sql, args);
    } catch (error) {
        logger.error("reports_get_stocktake_dashboard", {error});
        res.status(500).json({"message": "Error occured while retriving the Stocktake Dashboard data."});
        return;
    }

    res.status(200).json({"data": results});
};
