/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * @description Helper for passing large data between Scheduled and Map/Reduce scripts
 *              using File Cabinet files instead of script parameters (which are limited
 *              to ~4000 characters). Also provides graceful handling of "already running"
 *              errors when submitting Map/Reduce tasks.
 */
define(['N/file', 'N/search', 'N/record', 'N/log'], function (file, search, record, log) {

    var _tempFolderId = null;

    /**
     * Gets or creates the temp folder under SuiteScripts/AmazonConnector/temp.
     * Caches the folder ID after first lookup.
     * @returns {number} Internal ID of the temp folder
     */
    function getTempFolderId() {
        if (_tempFolderId) return _tempFolderId;

        // Try to find existing temp folder
        var folderSearch = search.create({
            type: 'folder',
            filters: [
                ['name', 'is', 'temp'],
                'AND',
                ['parent.name', 'is', 'AmazonConnector']
            ],
            columns: ['internalid']
        });

        var results = folderSearch.run().getRange({ start: 0, end: 1 });
        if (results.length > 0) {
            _tempFolderId = parseInt(results[0].id, 10);
            return _tempFolderId;
        }

        // Find parent AmazonConnector folder
        var parentSearch = search.create({
            type: 'folder',
            filters: [
                ['name', 'is', 'AmazonConnector'],
                'AND',
                ['parent.name', 'is', 'SuiteScripts']
            ],
            columns: ['internalid']
        });

        var parentResults = parentSearch.run().getRange({ start: 0, end: 1 });
        if (parentResults.length === 0) {
            throw new Error('Cannot find AmazonConnector folder in File Cabinet');
        }

        var parentId = parseInt(parentResults[0].id, 10);

        // Create temp folder
        var folder = record.create({ type: record.Type.FOLDER });
        folder.setValue({ fieldId: 'name', value: 'temp' });
        folder.setValue({ fieldId: 'parent', value: parentId });
        _tempFolderId = folder.save();

        log.debug({ title: 'mrDataHelper', details: 'Created temp folder with ID: ' + _tempFolderId });
        return _tempFolderId;
    }

    /**
     * Writes data to a JSON file in the File Cabinet temp folder.
     * @param {Object} data - The data object to serialize
     * @param {string} prefix - File name prefix (e.g., 'orders', 'returns', 'settlements')
     * @returns {number} Internal ID of the created file
     */
    function writeDataFile(data, prefix) {
        var jsonStr = JSON.stringify(data);
        var fileName = prefix + '_' + Date.now() + '.json';

        var fileObj = file.create({
            name: fileName,
            fileType: file.Type.JSON,
            contents: jsonStr,
            folder: getTempFolderId(),
            isOnline: false
        });

        var fileId = fileObj.save();
        log.debug({
            title: 'mrDataHelper.writeDataFile',
            details: 'Created file ' + fileName + ' (ID: ' + fileId + ', size: ' + jsonStr.length + ' chars)'
        });
        return fileId;
    }

    /**
     * Reads and parses a JSON data file from the File Cabinet, then deletes it.
     * @param {number|string} fileId - Internal ID of the file
     * @returns {Object} Parsed data object
     */
    function readDataFile(fileId) {
        var fileObj = file.load({ id: parseInt(fileId, 10) });
        var contents = fileObj.getContents();
        var data = JSON.parse(contents);

        // Delete the temp file after reading
        try {
            file['delete']({ id: parseInt(fileId, 10) });
        } catch (e) {
            log.debug({
                title: 'mrDataHelper.readDataFile',
                details: 'Could not delete temp file ' + fileId + ': ' + e.message
            });
        }

        return data;
    }

    /**
     * Submits an MR task with graceful handling of "already running" errors.
     * @param {Object} mrTask - The task object from task.create()
     * @param {string} logType - Log type constant for logging
     * @param {Object} logger - Logger module reference
     * @returns {string|null} Task ID if submitted, null if already running
     */
    function submitMrTask(mrTask, logType, logger) {
        try {
            return mrTask.submit();
        } catch (e) {
            if (e.name === 'MAP_REDUCE_ALREADY_RUNNING' ||
                (e.message && e.message.indexOf('already running') !== -1)) {
                logger.warn(logType,
                    'Map/Reduce deployment is already running. ' +
                    'Skipping submission - will retry on next scheduled run.', {
                    details: e.message
                });
                return null;
            }
            throw e;
        }
    }

    /**
     * Deletes a temp file. Used for cleanup when MR submission fails.
     * @param {number|string} fileId - Internal ID of the file to delete
     */
    function deleteTempFile(fileId) {
        try {
            file['delete']({ id: parseInt(fileId, 10) });
        } catch (e) {
            log.debug({
                title: 'mrDataHelper.deleteTempFile',
                details: 'Could not delete temp file ' + fileId + ': ' + e.message
            });
        }
    }

    return {
        writeDataFile: writeDataFile,
        readDataFile: readDataFile,
        submitMrTask: submitMrTask,
        deleteTempFile: deleteTempFile
    };
});
