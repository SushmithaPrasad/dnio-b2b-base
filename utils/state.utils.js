const log4js = require('log4js');
const { v4: uuid } = require('uuid');
const Async = require('async');

const httpClient = require('../http-client');
const config = require('../config');
const maskingUtils = require('./masking.utils');


const logger = log4js.getLogger(global.loggerName);
const interactionQueue = Async.priorityQueue(processInteraction);

global.interactionQueue = interactionQueue;

function getState(req, nodeId, isChild, contentType) {
	const data = {};
	data._id = uuid();
	data.flowId = config.flowId;
	data.nodeId = nodeId;
	// data.txnId = isChild ? uuid() : req.headers['data-stack-txn-id'];
	// data.remoteTxnId = req.headers['data-stack-remote-txn-id'];
	// data.parentTxnId = isChild ? req.headers['data-stack-txn-id'] : null;
	data.headers = req.headers;
	logger.trace(`State :: ${nodeId} :: Headers :: ${JSON.stringify(req.headers)}`);
	if (req.responseBody) {
		data.body = req.responseBody;
	} else {
		data.body = req.body;
	}
	data.fileContent = req.fileContent;
	logger.trace(`State :: ${nodeId} :: Body :: ${JSON.stringify(req.body)}`);
	data.params = req.params;
	data.query = req.query;
	logger.trace(`State :: ${nodeId} :: Query :: ${JSON.stringify(req.query)}`);
	data.interactionId = req.query.interactionId;
	data.status = 'PENDING';
	data.contentType = contentType || 'application/json';
	data._metadata = {
		createdAt: new Date(),
		lastUpdated: new Date(),
		deleted: false
	};
	if (req.statusCode) {
		data.statusCode = req.statusCode;
	} else {
		data.statusCode = 500;
	}
	data.outputFileName = req.outputFileName;
	return data;
}

async function upsertState(req, state) {
	const txnId = req.headers['data-stack-txn-id'];
	const remoteTxnId = req.headers['data-stack-remote-txn-id'];
	const interactionId = req.query.interactionId;
	const clonedState = JSON.parse(JSON.stringify(state));

	if (clonedState.body && maskingUtils[`maskDataFor${state.inputFormatId}`]) {
		if (Array.isArray(clonedState.body)) {
			clonedState.body.forEach(item => {
				maskingUtils[`maskDataFor${state.inputFormatId}`](item);
			});
		} else {
			maskingUtils[`maskDataFor${state.inputFormatId}`](clonedState.body);
		}
	}

	if (clonedState.responseBody && maskingUtils[`maskDataFor${state.outputFormatId}`]) {
		if (Array.isArray(clonedState.responseBody)) {
			clonedState.responseBody.forEach(item => {
				maskingUtils[`maskDataFor${state.outputFormatId}`](item);
			});
		} else {
			maskingUtils[`maskDataFor${state.outputFormatId}`](clonedState.responseBody);
		}
	}
	const dataPayload = {};
	dataPayload.flowId = clonedState.flowId;
	dataPayload.nodeId = clonedState.nodeId;
	dataPayload.interactionId = interactionId;
	dataPayload.body = clonedState.body;
	dataPayload.responseBody = clonedState.responseBody;
	dataPayload.batchList = clonedState.batchList;
	dataPayload.dataType = clonedState.contentType || 'application/json';
	dataPayload._metadata = clonedState._metadata;
	clonedState.payload = {};
	clonedState.responseData = {};
	if (clonedState.body) {
		if (Array.isArray(clonedState.body)) {
			clonedState.payload.type = 'Array';
			clonedState.payload.totalRecords = clonedState.body.length;
			if (clonedState.body[0]) {
				clonedState.payload.attributes = Object.keys(clonedState.body[0]).length;
			} else {
				clonedState.payload.attributes = 0;
			}
		} else {
			clonedState.payload.type = 'Object';
			clonedState.payload.totalRecords = 1;
			clonedState.payload.attributes = Object.keys(clonedState.body).length;
		}
	} else {
		clonedState.payload.type = 'Binary';
		clonedState.payload.totalRecords = null;
		clonedState.payload.attributes = null;
	}

	if (clonedState.responseBody) {
		if (Array.isArray(clonedState.responseBody)) {
			clonedState.responseData.type = 'Array';
			clonedState.responseData.totalRecords = clonedState.responseBody.length;
			if (clonedState.responseBody[0]) {
				clonedState.responseData.attributes = Object.keys(clonedState.responseBody[0]).length;
			} else {
				clonedState.responseData.attributes = 0;
			}
		} else {
			clonedState.responseData.type = 'Object';
			clonedState.responseData.totalRecords = 1;
			clonedState.responseData.attributes = Object.keys(clonedState.responseBody).length;
		}
	} else {
		clonedState.responseData.type = 'Binary';
		clonedState.responseData.totalRecords = null;
		clonedState.responseData.attributes = null;
	}

	delete clonedState._id;
	delete clonedState.body;
	delete clonedState.batchList;
	delete clonedState.responseBody;
	clonedState._metadata.lastUpdated = new Date();
	dataPayload._metadata.lastUpdated = new Date();
	logger.debug(`[${txnId}] [${remoteTxnId}] Starting Upsert Stage: ${JSON.stringify(state._id)}`);
	try {
		let status = await global.appcenterDB.collection('b2b.node.state').findOneAndUpdate(
			{ nodeId: state.nodeId, interactionId: state.interactionId, flowId: state.flowId },
			{ $set: clonedState },
			{ upsert: true }
		);
		logger.trace(`[${txnId}] [${remoteTxnId}] Upsert Stage State Result: ${JSON.stringify(status)}`);
		status = await global.appcenterDB.collection('b2b.node.state.data').findOneAndUpdate(
			{ nodeId: state.nodeId, interactionId: state.interactionId, flowId: state.flowId },
			{ $set: dataPayload },
			{ upsert: true }
		);
		logger.trace(`[${txnId}] [${remoteTxnId}] Upsert Stage Data Result: ${JSON.stringify(status)}`);
		if (state.status == 'ERROR') {
			logger.debug(`[${txnId}] [${remoteTxnId}] Setting Interaction State To Error: ${interactionId}`);
			await updateInteraction(req, { status: state.status });
		}
		logger.debug(`[${txnId}] [${remoteTxnId}] Ending Upsert Stage: ${JSON.stringify(state._id)}`);
	} catch (err) {
		logger.debug(`[${txnId}] [${remoteTxnId}] Ending Upsert Stage With Error: ${JSON.stringify(state._id)}`);
		logger.error(err);
	}
}

async function updateInteraction(req, data) {
	try {
		interactionQueue.push({ req, data });
	} catch (err) {
		logger.error(err);
	}
}

async function processInteraction(task, callback) {
	const req = task.req;
	const data = task.data;
	const txnId = req.headers['data-stack-txn-id'];
	const remoteTxnId = req.headers['data-stack-remote-txn-id'];
	const interactionId = req.query.interactionId;
	const b2bURL = `${config.baseUrlBM}/${config.app}/interaction/${config.flowId}/${interactionId}`;
	logger.debug(`[${txnId}] [${remoteTxnId}] Starting Update Interaction: ${interactionId}`);
	try {
		const status = await httpClient.request({
			method: 'PUT',
			url: b2bURL,
			json: data,
			headers: {
				'authorization': 'JWT ' + global.BM_TOKEN
			}
		});
		logger.debug(`[${txnId}] [${remoteTxnId}] Ending Update Interaction: ${interactionId}`);
		logger.trace(`[${txnId}] [${remoteTxnId}] State status :: ${status.statusCode} `);
		logger.trace(`[${txnId}] [${remoteTxnId}] State body:: ${JSON.stringify(status.body)} `);
		return true;
	} catch (err) {
		logger.debug(`[${txnId}] [${remoteTxnId}] Ending Update Interaction With Error: ${interactionId}`);
		logger.error(err);
		callback(err);
	}
}

module.exports.getState = getState;
module.exports.upsertState = upsertState;
module.exports.updateInteraction = updateInteraction;