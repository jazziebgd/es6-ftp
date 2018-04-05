module.exports = {
    plugins: [],
    recurseDepth: 100,
    source: {
        include: [
            './',
        ],
        exclude: [
            './index.js',
            './jsDocConfig.js',
            './.eslintrc.js',
            './node_modules',
            './test',
        ],
        includePattern: '.+\\.js$',
        excludePattern: '(^|\\/|\\\\)_'
    },
    sourceType: 'module',
    tags: {
        allowUnknownTags: true,
        dictionaries: ['jsdoc']
    },
    templates: {
        cleverLinks: false,
        monospaceLinks: false,
        default: {
            staticFiles: {
                include: [
                    '../jsdoc/static'
                ]
            },
            useLongnameInNav: false,
            includeDate: false,
        },
        menu: {
            defaultsortby: 'longname, version, since',
            modules: {
                show: true
            },
            namespaces: {
                show: true,
                showchildren: true,
                sortby: 'kind'
            },
            classes: {
                show: true,
                showchildren: true,
                sortby: 'kind'
            },
            globals: {
                show: false,
                sortby: 'kind'
            },
            events: {
                show: true,
                sortby: '',
                filtermodule: true
            },
            mixins: {
                show: true
            },
            interfaces: {
                show: true
            },
            tutorials: {
                show: true
            },
            externals: {
                show: true
            }
        }
    },
    opts: {
        template: '../jsdoc/templates/corcules-jsdoc',
        encoding: 'utf8',
        destination: './doc/',
        recurse: true,
    },
    vars: {
        mainTitle: 'es6-ftp',
    },
};