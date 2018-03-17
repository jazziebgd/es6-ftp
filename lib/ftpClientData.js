module.exports = {
    uploadCommands: [
        'APPE',
        'STOR',
    ],
    passiveCommands: [
        'APPE',
        'LIST',
        'MLSD',
        'NLST',
        'REST',
        'RETR',
        'STOR',
        'STOU',
    ],
    regexes: {
        listLine: /^([\-dl]{1})([\-rwx]{9})\s+?([\d]+)\s+?([^\s]+)\s+?([^\s]+)\s+?([\d]+)\s+?([^\s]+\s+?[^\s]+\s+?[^\s]+)\s+?(.*)$/
    },

    ftpResponseCodes: {
        110:   'Restart marker reply.',
        120:   'Service ready in nn minutes.',
        125:   'Data Connection already open; transfer starting.',
        150:   'File status okay; about to open data connection.',
        200:   'Command okay.',
        202:   'Command not implemented, superfluous at this site.',
        211:   'System status, or system help reply.',
        212:   'Directory status.',
        213:   'File status.',
        214:   'Help message.',
        215:   'NAME system type.',
        220:   'Service ready for new user.',
        221:   'Service closing control connection.',
        225:   'Data connection open; no transfer in progress.',
        226:   'Closing data connection.',
        227:   'Entering Passive Mode.',
        230:   'User logged in, proceed. This status code appears after the client sends the correct password. It indicates that the user has successfully logged on.',
        250:   'Requested file action okay, completed.',
        257:   '"PATHNAME" created.',
        331:   'User name okay, need password.',
        332:   'Need account for login.',
        350:   'Requested file action pending further information.',
        421:   'Error 421 Service not available, closing control connection. Error 421 User limit reached Error 421 You are not authorized to make the connection Error 421 Max connections reached Error 421 Max connections exceeded',
        425:   'Cannot open data connection.',
        426:   'Connection closed; transfer aborted.',
        450:   'Requested file action not taken.',
        451:   'Requested action aborted: local error in processing.',
        452:   'Requested action not taken. Insufficient storage space in system.',
        500:   'Syntax error, command unrecognized, command line too long.',
        501:   'Syntax error in parameters or arguments.',
        502:   'Command not implemented.',
        503:   'Bad sequence of commands.',
        504:   'Command not implemented for that parameter.',
        530:   'User not logged in.',
        532:   'Need account for storing files.',
        550:   'Requested action not taken. File unavailable, not found, not accessible',
        552:   'Requested file action aborted. Exceeded storage allocation.',
        553:   'Requested action not taken. File name not allowed.',
        10054: 'Connection reset by peer. The connection was forcibly closed by the remote host.',
        10060: 'Cannot connect to remote server.',
        10061: 'Cannot connect to remote server. The connection is actively refused by the server.',
        10066: 'Directory not empty.',
        10068: 'Too many users, server is full. '
    },

    featInformation: {
        'EPRT': {
            description: 'Extended port support',
            options: [],
        },
        'IDLE': {
            description: 'Setting server idle (inactive) timer support',
            options: [],
        },
        'MDTM': {
            description: 'Getting file modification time from server',
            options: [],
        },
        'SIZE': {
            description: 'Getting file size time from server',
            options: [],
        },
        'MFMT': {
            description: 'Setting file modification time in server',
            options: [],
        },
        'REST STREAM': {
            description: 'Restarting interrupted transfers in STREAM mode',
            options: [],
        },
        'MLST type*;size*;sizd*;modify*;UNIX.mode*;UNIX.uid*;UNIX.gid*;unique*;': {
            description: 'Get information on object from server through command channel (no data connection required)',
            options: [],
        },
        'MLSD': {
            description: 'Get standardized directory listing (replacement for LIST)',
            options: [],
        },
        'AUTH TLS': {
            description: 'TLS authentication support',
            options: [],
        },
        'AUTH SSL': {
            description: 'SSL authentication support',
            options: [],
        },
        'PBSZ': {
            description: 'Get protection buffer size',
            options: [],
        },
        'PROT': {
            description: 'Setting data connection protection level',
            options: [],
        },
        'TVFS': {
            description: 'TVFS (Trivial virtual file store) support',
            options: [],
        },
        'ESTA': {
            description: 'Establish active mode',
            options: [],
        },
        'PASV': {
            description: 'Passive mode ip and port information retrieving',
            options: [],
        },
        'EPSV': {
            description: 'Passive mode port information retrieving',
            options: [],
        },
        'SPSV': {
            description: 'Single port passive mode support',
            options: [],
        },
        'ESTP': {
            description: 'Establish passive mode',
            options: [],
        },
        'MODE Z': {
            description: 'Compression (zlib) support',
            options: [],
        },
        'UTF8': {
            description: 'UTF-8 feature support',
            options: [],
        },
        'CLNT': {
            description: 'Client identification support',
            options: [],
        },
        'MFF': {
            description: 'Support for setting file facts on server (create/acces/modification times, group/owner and permissions)',
            options: [],
        },
        'SITE UTIME': {
            description: 'Support for setting date and time attributes on server',
            options: [],
        },
        'SITE MKDIR': {
            description: 'Support for full-path MKDIR (creates all directories in given path)',
            options: [],
        },
        'SITE RMDIR': {
            description: 'Support for recursive RMDIR',
            options: [],
        },
        'SITE COPY': {
            description: 'Support for site COPY (?)',
            options: [],
        },
        'SITE LANG': {
            description: 'Support for setting language of server responses',
            options: [],
        },
        'SITE SYMLINK': {
            description: 'Support for creating symlinks on server',
            options: [],
        },
    }
};