const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');
const log4js = require('log4js');
const { exec, execSync } = require('child_process');

const codeGen = require('./code.generator');
const schemaUtils = require('./schema.utils');
const commonUtils = require('../utils/common.utils');
const config = require('../config');

const logger = log4js.getLogger(global.loggerName);

async function createProject(flowJSON) {
	logger.info(`Generating flow code for flow ID   :: ${flowJSON._id}`);
	logger.info(`Generating flow code for flow Name :: ${flowJSON.name}`);
	logger.info(`Generating flow code for flow App  :: ${flowJSON.app}`);
	try {
		if (!flowJSON.port) {
			flowJSON.port = 31000;
		}
		logger.info(`Generating flow code for flow Port :: ${flowJSON.port}`);
		// const folderPath = path.join(process.cwd(), 'generatedFlows', flowJSON._id);
		const folderPath = process.cwd();

		mkdirp.sync(path.join(folderPath, 'schemas'));
		mkdirp.sync(path.join(folderPath, 'SFTP-Files'));
		mkdirp.sync(path.join(folderPath, 'downloads'));

		if (flowJSON.dataStructures && Object.keys(flowJSON.dataStructures).length > 0) {
			Object.keys(flowJSON.dataStructures).forEach(schemaID => {
				let schema = flowJSON.dataStructures[schemaID];
				schema._id = schemaID;
				if (schema.definition) {
					fs.writeFileSync(path.join(folderPath, 'schemas', `${schemaID}.schema.json`), JSON.stringify(schemaUtils.convertToJSONSchema(schema)));
				}
			});
		}
		const appData = await commonUtils.getApp();
		flowJSON.appData = appData;
		const routerJSContent = await codeGen.parseFlow(flowJSON);
		const nodeUtilsContent = await codeGen.parseNodes(flowJSON);
		fs.writeFileSync(path.join(folderPath, 'route.js'), routerJSContent);
		fs.writeFileSync(path.join(folderPath, 'utils', 'node.utils.js'), nodeUtilsContent);
		fs.writeFileSync(path.join(folderPath, 'utils', 'file.utils.js'), codeGen.parseDataStructuresForFileUtils(flowJSON));
		fs.writeFileSync(path.join(folderPath, 'utils', 'validation.utils.js'), codeGen.parseDataStructures(flowJSON));
		fs.writeFileSync(path.join(folderPath, 'utils', 'masking.utils.js'), codeGen.parseDataStructuresForMasking(flowJSON));
		fs.writeFileSync(path.join(folderPath, 'flow.json'), JSON.stringify(flowJSON));
		fs.writeFileSync(path.join(folderPath, 'app-data.json'), JSON.stringify(appData));

		// fs.rmdirSync(path.join(folderPath, 'generator'), { recursive: true });

		logger.info('Project Created!');
	} catch (e) {
		logger.error('Project Error!', e);
		process.exit(0);
	}
}

let dockerRegistryType = process.env.DOCKER_REGISTRY_TYPE ? process.env.DOCKER_REGISTRY_TYPE : '';
if (dockerRegistryType.length > 0) dockerRegistryType = dockerRegistryType.toUpperCase();

let dockerReg = process.env.DOCKER_REGISTRY_SERVER ? process.env.DOCKER_REGISTRY_SERVER : '';
if (dockerReg.length > 0 && !dockerReg.endsWith('/') && dockerRegistryType != 'ECR') dockerReg += '/';


module.exports.createProject = createProject;