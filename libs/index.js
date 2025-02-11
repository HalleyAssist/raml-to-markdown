'use strict'
const extend = require('extend');
const raml2obj = require('raml2obj');
const nunjucks = require('nunjucks');
const pathJs = require('path');
const fs = require('fs');
const Promise = require('bluebird');
const helper = require('./helper.js');

/**
 * Enumeration providing a list of all built-in output types.
 * @enum
 */
module.exports.OutputType = {
    /** Just return a string. */
    ReturnOnly : 'ReturnOnly',
    /** Print all to stdout. */
    StdOut : 'StdOut',
    /** Write everything to files. */
    File : 'File'
}

/**
 * Enumeration providing a list of all possible file output types.
 * @enum
 */
module.exports.FileSplitting = {
    /** Put all results into one big file. */
    AllInOne : 'AllInOne',
    /** Create one result file per resource. */
    OnePerResource : 'OnePerResource',
    /** Create one result file per resource but handles versioning. */
    OnePerResourceVersioning : 'OnePerResourceVersioning',
}

/**
 * Defines a default configuration with all possible configuration options.
 *
 * @prop {object} input - Input configuration.
 * @prop {array} input.paths - A list of source paths to look for RAML files. This may contain files and directories.
 * @prop {boolean} input.recursive - Whenever to walk recursively through proviced directory paths.
 * @prop {RegExp} input.fileFilter - Regular Expression or function for more advanced filtering of files and directories to include.
 * @prop {string} input.templateFile - Nunjucks template file used to create templated output.
 * @prop {string} input.homeTemplateFile - Nunjucks template file used to generate a Home page (for GitHub) when using the "OnePerResourceVersioning" splitting option
 * @prop {string} input.contentFilter - Provides a pre-render content filter.
 * @prop {object} output - Output configuration.
 * @prop {OutputType} output.type - Output type configuration.
 * @prop {object} output.file - Configuration for OutputType.File.
 * @prop {FileSplitting} output.file.splitting - Defines on how file output should be generated.
 * @prop {string} output.file.path - Depending on the splitting option a single file or a directory path.
 * @prop {string} output.file.extension - Extension to add to each output file if *path* does not aleady represent a file path.
 * @prop {function}  output.contentFilter - Provides a post-render content filter.
 */
 module.exports.DefaultConfig = {
    input : {
        paths : [ ],
        recursive : false,
        fileFilter : new RegExp('\.raml$'),
        templateFile : __dirname + '/../templates/index.njk',
        contentFilter : null
    },
    output : {
        type : this.OutputType.ReturnOnly,
        file : {
            splitting : this.FileSplitting.AllInOne,
            path : null,
            extension : '.md'
        },
        contentFilter : item => item.replace(/\n{3,}/g, "\n\n")
    }
}

/**
 * Parses and renders RAML service definitions. Depending on the provided configuration, this method will send its
 * output to different locations.
 * @param {object} config - Configuration based on the options provided by [DefaultConfig](#defaultconfig).
 * @returns {Promise}
 */
module.exports.render = function(config)
{
    config = extend(true, { }, this.DefaultConfig, config);

    var templateFile = pathJs.resolve(config.input.templateFile);
    var contentFilter = config.output.contentFilter;
    var outputPath = config.output.file.path && pathJs.resolve(config.output.file.path);
    var outputExt = config.output.file.extension;
    var outputType = config.output.type;
    var outputSplitting = config.output.file.splitting;

    nunjucks.configure(pathJs.dirname(templateFile), { autoescape : false });

    return this.parse(config).then(files =>
    {
        var writeCallback;
        var result;

        if(outputType === this.OutputType.File)
        {
            if(outputSplitting === this.FileSplitting.AllInOne)
            {
                var rendered = helper.map(files, item =>
                {
                    var rendered = nunjucks.render(templateFile, item);
                    return (contentFilter && contentFilter(rendered)) || rendered;
                });
                if(!fs.existsSync(outputPath))
                    helper.mkdirp(outputPath);

                fs.writeFileSync(outputPath, rendered.join("\n\n\n"));
            }
            else if(outputSplitting === this.FileSplitting.OnePerResource)
            {
                helper.each(files, item =>
                {
                    helper.each(item.resources, res =>
                    {
                        item.resources = [ res ];

                        var rendered = nunjucks.render(templateFile, item);
                        
                        rendered = (contentFilter && contentFilter(rendered)) || rendered;

                        const filePath = pathJs.join(outputPath, res.displayName + outputExt);

                        if(!fs.existsSync(filePath))
                            helper.mkdirp(filePath);

                        fs.writeFileSync(filePath, rendered);
                    });
                });
            }
            else if(outputSplitting === this.FileSplitting.OnePerResourceVersioning)
            {
                helper.each(files, item =>
                {
                    // Create sorted contents page
                    for (const version of item.resources){
                        var versionEndpoints = version.resources
                        if (!versionEndpoints || !versionEndpoints.length)
                            continue

                        versionEndpoints.sort((a,b)=>{
                            if (a.displayName[0] < b.displayName[0])
                                return -1
                            if (a.displayName[0] > b.displayName[0])
                                return 1
                            return 0
                        })
                    }

                    // Create a home page if a template is provided
                    var homeTemplateFile = config.input.homeTemplateFile && pathJs.resolve(config.input.homeTemplateFile);
                    if (homeTemplateFile){
                        var renderedVersion = nunjucks.render(homeTemplateFile, item);
                        
                        renderedVersion = (contentFilter && contentFilter(renderedVersion)) || renderedVersion;
    
                        const filePathVersion = pathJs.join(outputPath, 'Home' + outputExt);
    
                        if(!fs.existsSync(filePathVersion))
                            helper.mkdirp(filePathVersion);
    
                        fs.writeFileSync(filePathVersion, renderedVersion);
                    }

                    helper.each(item.resources, version =>
                    {
                        helper.each(version.resources, res =>
                            {
                                // Create page for each resource of each version
                                item.resources = [ res ];

                                var rendered = nunjucks.render(templateFile, item);
                                
                                rendered = (contentFilter && contentFilter(rendered)) || rendered;
        
                                const filePath = pathJs.join(outputPath, res.displayName + '_' + version.uniqueId + outputExt);
        
                                if(!fs.existsSync(filePath))
                                    helper.mkdirp(filePath);
        
                                fs.writeFileSync(filePath, rendered);
                            });
                    });
                });
            }
        }
        else
        {
            var rendered = helper.map(files, item =>
            {
                var rendered = nunjucks.render(templateFile, item);
                return (contentFilter && contentFilter(rendered)) || rendered;

            }).join("\n\n\n");

            if(outputType === this.OutputType.ReturnOnly)
                result = rendered;
            else if(outputType === this.OutputType.StdOut)
                process.stdout.write(rendered);
        }

        return result;
    });
}

/**
 * Parses RAML service definitions returns a promise containing an object with all parsed values when resolved.
 * @param {object} config - Configuration based on the options provided by [DefaultConfig](#defaultconfig)
 * @returns {Promise}
 */
module.exports.parse = function(config)
{
    config = extend(true, { }, this.DefaultConfig, config);

    var contentFilter = config.input.contentFilter;

    return Promise.all(helper.map(config.input.paths, path =>
    {
        try
        {
            var fileFilter = config.input.fileFilter;

            if(typeof fileFilter === 'object')
                fileFilter = (path) => config.input.fileFilter.test(path);

            var files = helper.listFiles(path, config.input.recursive, fileFilter);
            return Promise.all(helper.map(files, file => raml2obj.parse(file)));

        }
        catch(e)
        {
            return Promise.reject(e);
        }
    }))
    .then(items =>
    {
        var relaxed = helper.unwindArray(items);
        relaxed = (contentFilter && relaxed.map(contentFilter)) || relaxed;

        var deepKeys = [ 'resources', 'methods', 'responses', 'body' ];
        helper.recursiveEach(relaxed, deepKeys, body =>
        {

            var props = body.properties || body.items.properties;

            if(props)
                props.sort((a, b) => a.displayName.localeCompare(b.displayName));
        });

        return relaxed;
    });
}
