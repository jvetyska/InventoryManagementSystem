var api = require("../microwarehouse-api/mw_api_taskgroup.js");
var express = require("express");
var router = express.Router();
var Auth = require("../library/auth.js").Auth;

/**
 * @swagger
 * /api/taskgroup/group_pick_tasks:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - taskgroup
 *     summary: assign all un-groupped tasks to group(s)
 *     description: |
 *       Assign all tasks with taskgroupID of null into task_groups based on destination and other logic
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: name
 *         description: name of promotion (promo only)
 *         in: query
 *         required: false
 *         type: string
 *       - name: source
 *         description: source of tasks (Promo, Auto, Manual)
 *         in: query
 *         required: false
 *         type: string
 *         enum:
 *           - Promo
 *           - Auto
 *           - Manual
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/taskgroup/group_pick_tasks", Auth(["admin"]), api.group_pick_tasks);

/**
 * @swagger
 * /api/taskgroup/group_inventory_tasks:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - taskgroup
 *     summary: Group Inventory tasks
 *     description: |
 *       Group Inventory type tasks
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: restricted
 *         description: Only Restricted tasks?
 *         in: query
 *         required: false
 *         type: boolean
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/taskgroup/group_inventory_tasks", Auth(["admin"]), api.group_inventory_tasks);

/**
 * @swagger
 * /api/taskgroup/group_cross_dock_tasks:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - taskgroup
 *     summary: Group Cross Dock tasks
 *     description: |
 *       Group Cross Dock type tasks
 *     produces:
 *       - application/json
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/taskgroup/group_cross_dock_tasks", Auth(["admin"]), api.group_cross_dock_tasks);

/**
 * @swagger
 * /api/taskgroup/get_available:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - taskgroup
 *     summary: get currently available, unclaimed task groups per location
 *     description: |
 *       Get all available, unclaimed groups of tasks for current location
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: location
 *         description: location to retrieve task groups for
 *         in: query
 *         required: true
 *         type: string
 *       - name: type
 *         description: type of the tasks, such as Pick, Stow, ...
 *         in: query
 *         required: false
 *         type: string
 *         enum:
 *           - Pick
 *           - Stow
 *           - Inventory
 *           - Online
 *           - Pack
 *           - Reprice
 *           - BackfillCount
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/taskgroup/get_available", Auth(), api.get_available);

/**
 * @swagger
 * /api/taskgroup/get_inprogress:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - taskgroup
 *     summary: get currently in progress task groups per location
 *     description: |
 *       Get all in-progress groups of tasks for current location
 *       In-progress means that some of the tasks were completed.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: location
 *         description: location to retrieve task groups for
 *         in: query
 *         required: true
 *         type: string
 *       - name: type
 *         description: type of the tasks, such as Pick, Stow, ...
 *         in: query
 *         required: false
 *         type: string
 *         enum:
 *           - Pick
 *           - Stow
 *           - Inventory
 *           - Online
 *           - Pack
 *           - Reprice
 *           - BackfillCount
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/taskgroup/get_inprogress", Auth(), api.get_inprogress);

/**
 * @swagger
 * /api/taskgroup/unlock:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - task
 *     summary: opens task to be worked on
 *     description: |
 *       Removes Assigned User from a taskgroup
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: taskgroup_id
 *         description: ID of a taskgroup
 *         in: query
 *         required: true
 *         type: integer
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/taskgroup/unlock", Auth(), api.taskgroup_unlock);

/**
 * @swagger
 * /api/taskgroup/setup:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - taskgroup
 *     summary: Gets information from task groups (specific for online order tasks)
 *     description: |
 *       Gets information from task groups (specific for online order tasks)
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: id
 *         description: ID of the task group to retrieve information from
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/taskgroup/setup", Auth(), api.get_setup);

/**
 * @swagger
 * /api/taskgroup/setup:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - taskgroup
 *     summary: TODO
 *     description: |
 *       TODO
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *               container:
 *                 type: string
 *             examples:
 *               id:
 *                 value: 123
 *                 summary: ID of the task group to retrieve information from
 *               container:
 *                 value: 1001-BOH1, 1001-BOH2
 *                 summary: An array of strings that specify which containers will be used
 *             required:
 *               - id
 *               - container
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/taskgroup/setup", Auth(), api.post_setup);

/**
 * @swagger
 * /api/taskgroup/create:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - taskgroup
 *     summary: create new taskgroup
 *     description: |
 *       Create a new group of tasks
 *       Example:  source_location: MIL1-STR, target_location:LYN1-WRH, due_date: 2018-10-12T10:30:06-05:00, priority: standard, type: pick
 *     produces:
 *       - application/json
 *     consumes:
 *       - application/x-www-form-urlencoded
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               source_location:
 *                 type: string
 *               target_location:
 *                 type: string
 *               due_date:
 *                 type: string
 *               priority:
 *                 type: string
 *                 enum:
 *                   - Standard
 *                   - Fasttrack
 *                   - CrossDock
 *                   - Instant
 *               type:
 *                 type: string
 *                 enum:
 *                   - Backfill
 *                   - CasePick
 *                   - CrossDock
 *                   - Inventory
 *                   - Online
 *                   - Pick
 *                   - Replenish
 *                   - Reprice
 *               cart_type:
 *                 type: string
 *                 enum:
 *                   - Standard
 *                   - Apparel
 *                   - TableLines
 *               reference_id:
 *                 type: string
 *             examples:
 *               source_location:
 *                 value: MIL1-STR
 *                 summary: Source Location
 *               target_location:
 *                 value: MIL1-STR
 *                 summary: Target Location
 *               due_date:
 *                 value: 2021-04-11
 *                 summary: Due date for completing the task
 *               priority:
 *                 value: Standard
 *                 summary: priority of fulfillment
 *               type:
 *                 value: Backfill
 *                 summary: type of task
 *               cart_type:
 *                 value: Standard
 *                 summary: Cart type of the task group
 *               reference_id:
 *                 value: 123
 *                 summary: type of task
 *             required:
 *               - source_location
 *               - target_location
 *               - due_date
 *               - priority
 *               - type
 *               - cart_type
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/taskgroup/create", Auth(["admin"]), api.taskgroup_create);

/**
 * @swagger
 * /api/taskgroup/fulfillTaskGroup:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - taskgroup
 *     summary: Fulfills task group if all tasks are complete in it
 *     description: |
 *       TODO
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               task_id:
 *                 type: integer
 *             examples:
 *               task_id:
 *                 value: 123
 *                 summary: Fulfills task group if all tasks are complete in it
 *             required:
 *               - task_id
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/taskgroup/fulfillTaskGroup", Auth(), api.fulfill_task_group);

/**
 * @swagger
 * /api/taskgroup/close_task_group:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - taskgroup
 *     summary: Closes task group and all realted tasks, replenish orders and frees inventory
 *     description: |
 *       Closes task group and all realted tasks, replenish orders and frees inventory
 *     produces:
 *       - application/json
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               task_group_id:
 *                 type: integer
 *             examples:
 *               task_group_id:
 *                 value: 123
 *                 summary: ID of the task_group
 *             required:
 *               - task_group_id
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/taskgroup/close_task_group", Auth(["admin"]), api.close_task_group);

/**
 * @swagger
 * /api/taskgroup/get_details:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - taskgroup
 *     summary: get taskgroup by id
 *     description: |
 *       Get taskgroup data
 *     produces:
 *       - application/json
 *     parameters:
*       - name: taskGroupID
 *         description: taskgroup id
 *         in: query
 *         required: true
 *         type: string
*       - name: locationID
 *         description: Warehouse Location
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/taskgroup/get_details", Auth(), api.get_details);

module.exports = router;
