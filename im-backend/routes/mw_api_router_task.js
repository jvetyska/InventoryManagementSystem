var api = require("../microwarehouse-api/mw_api_task.js");
var express = require("express");
var router = express.Router();
var Auth = require("../library/auth.js").Auth;

/**
 * @swagger
 * /api/task/get_info:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - task
 *     summary: Gets basic information about a task
 *     description: |
 *       Gets basic information about a task which includes the Product ID, Quantities, Containers, and isRestricted
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: task_id
 *         description: ID of a task
 *         in: query
 *         required: true
 *         type: integer
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/task/get_info", Auth(), api.get_info);

/**
 * @swagger
 * /api/task/get_next:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - task
 *     summary: get next available task for pick types
 *     description: |
 *       Get next available task in your task group
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: taskgroupId
 *         description: ID of a taskgroup
 *         in: query
 *         required: true
 *         type: integer
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/task/get_next", Auth(), api.get_next);

/**
 * @swagger
 * /api/task/get_backfill_requirements:
 *   get:
 *     security:
 *       - login: []
 *     tags:
 *       - task
 *     summary: Gets the tasks required to generate backfill
 *     description: |
 *          Gets the tasks required to generate backfill.
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: LocationID
 *         description: ID of a location
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/task/get_backfill_requirements", Auth(), api.get_backfill_requirements);

/**
 * @swagger
 * /api/task/create:
 *   post:
 *     security:
 *       - login: []
 *     tags:
 *       - task
 *     summary: create new task
 *     description: |
 *       Create a new task.
 *       Either source or target container field is required.
 *       Type is required, Task group is optional as tasks can be groupped later.
 *       Example:  taskgroup id: 1
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
 *               type:
 *                 type: string
 *                 enum:
 *                   - Pick
 *                   - Replenish
 *                   - Inventory
 *                   - Online
 *               barcode:
 *                 type: string
 *               quantity:
 *                 type: number
 *               taskgroup_id:
 *                 type: string
 *               source_container:
 *                 type: string
 *               target_container:
 *                 type: string
 *               is_restricted:
 *                 type: boolean
 *             examples:
 *               type:
 *                 value: Backfill
 *                 summary: Type of the task
 *               barcode:
 *                 value: Backfill
 *                 summary: product barcode
 *               quantity:
 *                 value: 10
 *                 summary: quantity of product to handle
 *               taskgroup_id:
 *                 value: 123
 *                 summary: taskgroup ID
 *               source_container:
 *                 value: 1001-BOH1
 *                 summary: source container barcode
 *               targer_container:
 *                 value: 1001-BOH1
 *                 summary: target container barcode
 *               is_restricted:
 *                 value: false
 *                 summary: is restricted
 *             required:
 *               - type
 *               - barcode
 *               - quantity
 *               - taskgroup_id
 *               - source_container
 *               - target_container
 *     responses:
 *       200:
 *         description: OK
 */
router.post("/task/create", Auth(), api.task_create);

/**
 * @swagger
 * /api/task/skip_task:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - task
 *     summary: skip current task
 *     description: |
 *       Skip current task in your task group
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
 *                 summary: ID of the task to skip
 *             required:
 *               - task_id
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/task/skip_task", Auth(), api.skip_task);

/**
 * @swagger
 * /api/task/update:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - task
 *     summary: Update the progress of the task
 *     description: |
 *       Executes task action and updates quantity filled.
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
 *               source_container:
 *                 type: string
 *               target_container:
 *                 type: string
 *               quantity:
 *                 type: number
 *               process:
 *                 type: string
 *             examples:
 *               task_id:
 *                 value: 123
 *                 summary: ID of a task
 *               source_container:
 *                 value: 1001-BOH1
 *                 summary: source container, or FROM
 *               target_container:
 *                 value: 1001-BOH1
 *                 summary: target container, or TO
 *               quantity:
 *                 value: 10
 *                 summary: the amount of products to move which defaults to 1 if not provided
 *               process:
 *                 value: case
 *                 summary: Can be used for "online-order" or "case". Most of the time this will not be passed into the API request
 *             required:
 *               - task_id
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/task/update", Auth(), api.update_task);

/**
 * @swagger
 * /api/task/complete:
 *   put:
 *     security:
 *       - login: []
 *     tags:
 *       - task
 *     summary: Mark task as complete
 *     description: |
 *       Executes task action and marks task as complete.
 *       Either source or target container field is required.
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
 *               quantity:
 *                 type: number
 *               source_container:
 *                 type: string
 *               target_container:
 *                 type: string
 *               process:
 *                 type: string
 *               reason:
 *                 type: string
 *               customReason:
 *                 type: string
 *             examples:
 *               task_id:
 *                 value: 123
 *                 summary: ID of a task
 *               quantity:
 *                 value: 10
 *                 summary: Optional quantity value if different
 *               source_container:
 *                 value: 1001-BOH1
 *                 summary: source container, or FROM
 *               target_container:
 *                 value: 1001-BOH1
 *                 summary: target container, or TO
 *               process:
 *                 value: case
 *                 summary: Can be used for "online-order" or "case". Most of the time this will not be passed into the API request
 *               reason:
 *                 value: My reason
 *                 summary: Used for inventory tasks. User chosen reason for inventory discrepancy between Anko inventory and external inventory (Kmart inventory)
 *               customReason:
 *                 value: My custom reason
 *                 summary: Used for inventory tasks. User chosen reason for inventory discrepancy between Anko inventory and external inventory (Kmart inventory)
 *             required:
 *               - task_id
 *               - source_container
 *               - target_container
 *     responses:
 *       200:
 *         description: OK
 */
router.put("/task/complete", Auth(), api.complete_task);

/**
 * @swagger
 * /api/debug_get_task_by_taskGroup:
 *   get:
 *     tags:
 *       - task_group
 *     summary: get tasks by taskGroupId
 *     description: |
 *       Get tasks associated with taskgroup
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: taskGroupID
 *         description: taskgroup id
 *         in: query
 *         required: true
 *         type: string
 *     responses:
 *       200:
 *         description: OK
 */
router.get("/debug_get_task_by_taskGroupID", Auth(), api.debug_get_task_by_taskGroup);

/**
 * @swagger
 * /api/debug_get_task_by_ID:
 *   get:
 *     tags:
 *       - task
 *     summary: get tasks by ID
 *     description: |
 *       Get task
 *     produces:
 *       - application/json
 *     parameters:
 *       - name: taskID
 *         description: task id
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
router.get("/debug_get_task_by_ID", Auth(), api.debug_get_task_by_ID);

module.exports = router;
