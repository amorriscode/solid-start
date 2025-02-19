// All credit for this work goes to the amazing Next.js team.
// https://github.com/vercel/next.js/blob/canary/packages/next/build/babel/plugins/next-ssg-transform.ts
// This is adapted to work with any server() calls and transpile it into multiple api function for a file.

import crypto from "crypto";

function decorateServerExport(t, path, state) {
  const gsspName = "__has_server";
  const gsspId = t.identifier(gsspName);
  const addGsspExport = exportPath => {
    if (state.done) {
      return;
    }
    state.done = true;
    const [pageCompPath] = exportPath.replaceWithMultiple([
      t.exportNamedDeclaration(
        t.variableDeclaration("var", [t.variableDeclarator(gsspId, t.booleanLiteral(true))]),
        [t.exportSpecifier(gsspId, gsspId)]
      ),
      exportPath.node
    ]);
    exportPath.scope.registerDeclaration(pageCompPath);
  };

  path.traverse({
    ExportDefaultDeclaration(exportDefaultPath) {
      // addGsspExport(exportDefaultPath);
    },
    ExportNamedDeclaration(exportNamedPath) {
      // addGsspExport(exportNamedPath);
    }
  });
}

function transformServer({ types: t, template }) {
  function getIdentifier(path) {
    const parentPath = path.parentPath;
    if (parentPath.type === "VariableDeclarator") {
      const pp = parentPath;
      const name = pp.get("id");
      return name.node.type === "Identifier" ? name : null;
    }
    if (parentPath.type === "AssignmentExpression") {
      const pp = parentPath;
      const name = pp.get("left");
      return name.node.type === "Identifier" ? name : null;
    }
    if (path.node.type === "ArrowFunctionExpression") {
      return null;
    }
    return path.node.id && path.node.id.type === "Identifier" ? path.get("id") : null;
  }
  function isIdentifierReferenced(ident) {
    const b = ident.scope.getBinding(ident.node.name);
    if (b?.referenced) {
      if (b.path.type === "FunctionDeclaration") {
        return !b.constantViolations
          .concat(b.referencePaths)
          .every(ref => ref.findParent(p => p === b.path));
      }
      return true;
    }
    return false;
  }
  function markFunction(path, state) {
    const ident = getIdentifier(path);
    if (ident?.node && isIdentifierReferenced(ident)) {
      state.refs.add(ident);
    }
  }
  function markImport(path, state) {
    const local = path.get("local");
    if (isIdentifierReferenced(local)) {
      state.refs.add(local);
    }
  }

  function hashFn(str) {
    return crypto
      .createHash("shake256", { outputLength: 5 /* bytes = 10 hex digits*/ })
      .update(str)
      .digest("hex");
  }
  return {
    visitor: {
      Program: {
        enter(path, state) {
          state.refs = new Set();
          state.isPrerender = false;
          state.isServerProps = false;
          state.done = false;
          state.servers = 0;
          path.traverse(
            {
              VariableDeclarator(variablePath, variableState) {
                if (variablePath.node.id.type === "Identifier") {
                  const local = variablePath.get("id");
                  if (isIdentifierReferenced(local)) {
                    variableState.refs.add(local);
                  }
                } else if (variablePath.node.id.type === "ObjectPattern") {
                  const pattern = variablePath.get("id");
                  const properties = pattern.get("properties");
                  properties.forEach(p => {
                    const local = p.get(
                      p.node.type === "ObjectProperty"
                        ? "value"
                        : p.node.type === "RestElement"
                        ? "argument"
                        : (function () {
                            throw new Error("invariant");
                          })()
                    );
                    if (isIdentifierReferenced(local)) {
                      variableState.refs.add(local);
                    }
                  });
                } else if (variablePath.node.id.type === "ArrayPattern") {
                  const pattern = variablePath.get("id");
                  const elements = pattern.get("elements");
                  elements.forEach(e => {
                    let local;
                    if (e.node?.type === "Identifier") {
                      local = e;
                    } else if (e.node?.type === "RestElement") {
                      local = e.get("argument");
                    } else {
                      return;
                    }
                    if (isIdentifierReferenced(local)) {
                      variableState.refs.add(local);
                    }
                  });
                }
              },
              ExportDefaultDeclaration(exportNamedPath, exportNamedState) {
                if (!state.opts.keep) {
                  exportNamedPath.remove();
                }
              },
              ExportNamedDeclaration(exportNamedPath, exportNamedState) {
                if (!state.opts.keep) {
                  return;
                }
                const specifiers = exportNamedPath.get("specifiers");
                if (specifiers.length) {
                  specifiers.forEach(s => {
                    if (
                      t.isIdentifier(s.node.exported)
                        ? s.node.exported.name
                        : s.node.exported.value === "routeData"
                    ) {
                      s.remove();
                    }
                  });
                  if (exportNamedPath.node.specifiers.length < 1) {
                    exportNamedPath.remove();
                  }
                  return;
                }
                const decl = exportNamedPath.get("declaration");
                if (decl == null || decl.node == null) {
                  return;
                }
                switch (decl.node.type) {
                  case "FunctionDeclaration": {
                    const name = decl.node.id.name;
                    if (name === "routeData") {
                      exportNamedPath.remove();
                    }
                    break;
                  }
                  case "VariableDeclaration": {
                    const inner = decl.get("declarations");
                    inner.forEach(d => {
                      if (d.node.id.type !== "Identifier") {
                        return;
                      }
                      const name = d.node.id.name;
                      if (name === "routeData") {
                        d.remove();
                      }
                    });
                    break;
                  }
                  default: {
                    break;
                  }
                }
              },
              FunctionDeclaration: markFunction,
              FunctionExpression: markFunction,
              ArrowFunctionExpression: markFunction,
              ImportSpecifier: markImport,
              ImportDefaultSpecifier: markImport,
              ImportNamespaceSpecifier: markImport
            },
            state
          );

          const refs = state.refs;
          let count;
          function sweepFunction(sweepPath) {
            const ident = getIdentifier(sweepPath);
            if (ident?.node && refs.has(ident) && !isIdentifierReferenced(ident)) {
              ++count;
              if (
                t.isAssignmentExpression(sweepPath.parentPath) ||
                t.isVariableDeclarator(sweepPath.parentPath)
              ) {
                sweepPath.parentPath.remove();
              } else {
                sweepPath.remove();
              }
            }
          }
          function sweepImport(sweepPath) {
            const local = sweepPath.get("local");
            if (refs.has(local) && !isIdentifierReferenced(local)) {
              ++count;
              sweepPath.remove();
              if (sweepPath.parent.specifiers.length === 0) {
                sweepPath.parentPath.remove();
              }
            }
          }
          do {
            path.scope.crawl();
            count = 0;
            path.traverse({
              VariableDeclarator(variablePath) {
                if (variablePath.node.id.type === "Identifier") {
                  const local = variablePath.get("id");
                  if (refs.has(local) && !isIdentifierReferenced(local)) {
                    ++count;
                    variablePath.remove();
                  }
                } else if (variablePath.node.id.type === "ObjectPattern") {
                  const pattern = variablePath.get("id");
                  const beforeCount = count;
                  const properties = pattern.get("properties");
                  properties.forEach(p => {
                    const local = p.get(
                      p.node.type === "ObjectProperty"
                        ? "value"
                        : p.node.type === "RestElement"
                        ? "argument"
                        : (function () {
                            throw new Error("invariant");
                          })()
                    );
                    if (refs.has(local) && !isIdentifierReferenced(local)) {
                      ++count;
                      p.remove();
                    }
                  });
                  if (beforeCount !== count && pattern.get("properties").length < 1) {
                    variablePath.remove();
                  }
                } else if (variablePath.node.id.type === "ArrayPattern") {
                  const pattern = variablePath.get("id");
                  const beforeCount = count;
                  const elements = pattern.get("elements");
                  elements.forEach(e => {
                    let local;
                    if (e.node?.type === "Identifier") {
                      local = e;
                    } else if (e.node?.type === "RestElement") {
                      local = e.get("argument");
                    } else {
                      return;
                    }
                    if (refs.has(local) && !isIdentifierReferenced(local)) {
                      ++count;
                      e.remove();
                    }
                  });
                  if (beforeCount !== count && pattern.get("elements").length < 1) {
                    variablePath.remove();
                  }
                }
              },
              FunctionDeclaration: sweepFunction,
              FunctionExpression: sweepFunction,
              ArrowFunctionExpression: sweepFunction,
              ImportSpecifier: sweepImport,
              ImportDefaultSpecifier: sweepImport,
              ImportNamespaceSpecifier: sweepImport
            });
          } while (count);
          decorateServerExport(t, path, state);
        }
      }
    }
  };
}
export { transformServer as default };
